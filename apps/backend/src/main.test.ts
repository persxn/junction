import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { HealthResponse, ReadyLine } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { baseUrlOf, spawnBackend, type BackendProcess } from './testing/backend-process.js';
import { makeTempDir, removeTempDir } from './testing/temp.js';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
// `--import` needs a file:// URL on Windows, not a drive-letter path.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const temps: string[] = [];
const running: BackendProcess[] = [];

function tempDir(): string {
  const dir = makeTempDir('main');
  temps.push(dir);
  return dir;
}

/** How many migrations this build ships, read from the journal the migrator uses. */
function journalEntryCount(): number {
  const journal = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, '..', 'migrations', 'meta', '_journal.json'),
      'utf8',
    ),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

/** Runs `src/main.ts` the way the shell runs the bundle: a real child process. */
function start(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<BackendProcess> {
  return spawnBackend({
    command: process.execPath,
    args: ['--import', TSX, MAIN, ...args],
    env: { PORT: '0', ...env },
  }).then((backend) => {
    running.push(backend);
    return backend;
  });
}

afterEach(() => {
  while (running.length > 0) {
    running.pop()?.child.kill();
  }
  while (temps.length > 0) {
    removeTempDir(temps.pop() ?? '');
  }
});

// Each case spawns a real backend through tsx: a cold compile of the whole
// backend plus every migration. Alone that is ~2 s; under the full parallel
// suite the first spawn reached 22 s once M1 had added its migrations (WP-12
// measured the same failure on the WP-11 commit), so these get more room than
// the suite's 20 s default. WP-31's bundled backend does not pay the tsx cost.
describe('startup handshake', { timeout: 60_000 }, () => {
  it('writes one READY line that parses against the contract', async () => {
    const secret = randomBytes(32).toString('hex');
    const backend = await start(['--data-dir', tempDir()], { COMPINTEL_CLIENT_SECRET: secret });

    expect(ReadyLine.parse(backend.ready)).toStrictEqual(backend.ready);
    expect(backend.ready.ready).toBe(true);
    if (backend.ready.ready) {
      expect(backend.ready.port).toBeGreaterThan(0);
      expect(backend.ready.pid).toBe(backend.child.pid);
      expect(backend.ready.apiVersion).toBe('1.0.0');
    }
  });

  it('serves /health with the secret and 401 without it', async () => {
    const secret = randomBytes(32).toString('hex');
    const backend = await start(['--data-dir', tempDir()], { COMPINTEL_CLIENT_SECRET: secret });
    const baseUrl = baseUrlOf(backend);

    const ok = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'X-CompIntel-Client': secret },
    });
    expect(ok.status).toBe(200);
    const health = HealthResponse.parse(await ok.json());
    expect(health.status).toBe('ok');
    expect(health.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(health.database.ok).toBe(true);
    // Every migration this build ships is applied; the count grows per WP.
    expect(health.database.migrationsApplied).toBe(journalEntryCount());

    const denied = await fetch(`${baseUrl}/api/v1/health`);
    expect(denied.status).toBe(401);
  });

  it('keeps stdout free of everything but the READY line', async () => {
    const secret = randomBytes(32).toString('hex');
    const dataDir = tempDir();
    const backend = await start(['--data-dir', dataDir, '--stdin-lifeline'], {
      COMPINTEL_CLIENT_SECRET: secret,
    });
    await fetch(`${baseUrlOf(backend)}/api/v1/health`, {
      headers: { 'X-CompIntel-Client': secret },
    });

    backend.child.stdin.end();
    await backend.waitForExit();
    expect(backend.trailingStdout().trim()).toBe('');
    // The same run must still have produced a log file.
    expect(readFileSync(path.join(dataDir, 'logs', logFileName()), 'utf8')).toContain(
      'backend listening',
    );
  });

  it('writes dev-connection.json only when --dev generated the secret', async () => {
    const dataDir = tempDir();
    const backend = await start(['--data-dir', dataDir, '--dev']);
    const file = path.join(dataDir, 'dev-connection.json');
    const connection: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(connection).toStrictEqual({
      baseUrl: baseUrlOf(backend),
      clientSecret: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
  });

  it('does not write dev-connection.json when the secret came from the environment', async () => {
    const dataDir = tempDir();
    await start(['--data-dir', dataDir, '--dev'], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });
    expect(() => readFileSync(path.join(dataDir, 'dev-connection.json'))).toThrow(/ENOENT/);
  });
});

describe('failed start', () => {
  it('reports ready:false and exits 1 when the data directory is unusable', async () => {
    const blocker = path.join(tempDir(), 'a-file');
    writeFileSync(blocker, 'in the way');

    const backend = await start(['--data-dir', blocker], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });

    expect(backend.ready.ready).toBe(false);
    if (!backend.ready.ready) {
      expect(backend.ready.error.code).toBe('DATA_DIR_UNUSABLE');
      expect(backend.ready.error.message).toContain(blocker);
    }
    expect(await backend.waitForExit(5000)).toBe(1);
  });

  it('reports ready:false when the client secret is missing outside --dev', async () => {
    const backend = await start(['--data-dir', tempDir()]);

    expect(backend.ready.ready).toBe(false);
    if (!backend.ready.ready) {
      expect(backend.ready.error.code).toBe('CONFIG_INVALID');
      expect(backend.ready.error.message).toContain('COMPINTEL_CLIENT_SECRET');
    }
    expect(await backend.waitForExit(5000)).toBe(1);
  });
});

describe('database and data-dir lock', () => {
  it('creates app.db, applies the migrations and reports them on /health', async () => {
    const secret = randomBytes(32).toString('hex');
    const dataDir = tempDir();
    const backend = await start(['--data-dir', dataDir], { COMPINTEL_CLIENT_SECRET: secret });

    expect(existsSync(path.join(dataDir, 'data', 'app.db'))).toBe(true);
    const health = HealthResponse.parse(
      await (
        await fetch(`${baseUrlOf(backend)}/api/v1/health`, {
          headers: { 'X-CompIntel-Client': secret },
        })
      ).json(),
    );
    expect(health.database.ok).toBe(true);
    expect(health.database.migrationsApplied).toBeGreaterThanOrEqual(1);
    expect(readdirSync(path.join(dataDir, 'backups-local'))).toStrictEqual([]);
  });

  it('starts the job runner and stops it before the database closes (WP-04c)', async () => {
    const dataDir = tempDir();
    const backend = await start(['--data-dir', dataDir, '--stdin-lifeline'], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });

    backend.child.stdin.end();
    expect(await backend.waitForExit(5000)).toBe(0);

    const log = readFileSync(path.join(dataDir, 'logs', logFileName()), 'utf8');
    expect(log).toContain('scheduler started');
    expect(log).toContain('scheduler stopped');
    // Registration order in main.ts puts the scheduler after the database, and
    // `resources` hooks run newest first, so the runner is quiet before the
    // database is checkpointed and closed (ruling R14).
    expect(log.indexOf('graceful shutdown started')).toBeLessThan(log.indexOf('scheduler stopped'));
    expect(log.indexOf('scheduler stopped')).toBeLessThan(
      log.indexOf('graceful shutdown finished'),
    );
  });

  it('holds backend.lock while it runs and removes it on a clean exit', async () => {
    const dataDir = tempDir();
    const backend = await start(['--data-dir', dataDir, '--stdin-lifeline'], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });

    const lockFile = path.join(dataDir, 'backend.lock');
    expect(JSON.parse(readFileSync(lockFile, 'utf8'))).toMatchObject({
      pid: backend.child.pid,
    });

    backend.child.stdin.end();
    expect(await backend.waitForExit(5000)).toBe(0);
    expect(existsSync(lockFile)).toBe(false);
  });

  it('refuses a second backend on the same data directory (R15)', async () => {
    const dataDir = tempDir();
    const first = await start(['--data-dir', dataDir], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });
    expect(first.ready.ready).toBe(true);

    const second = await start(['--data-dir', dataDir], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });

    expect(second.ready.ready).toBe(false);
    if (!second.ready.ready) {
      expect(second.ready.error.code).toBe('DATA_DIR_LOCKED');
      expect(second.ready.error.message).toContain(dataDir);
    }
    expect(await second.waitForExit(5000)).toBe(1);

    // The refusal must not have disturbed the backend that owns the directory.
    expect(first.child.exitCode).toBeNull();
  });

  it('reports DB_CORRUPT and exits 1 when app.db is not a database', async () => {
    const dataDir = tempDir();
    mkdirSync(path.join(dataDir, 'data'), { recursive: true });
    writeFileSync(path.join(dataDir, 'data', 'app.db'), 'not a database at all');

    const backend = await start(['--data-dir', dataDir], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });

    expect(backend.ready.ready).toBe(false);
    if (!backend.ready.ready) {
      expect(['DB_OPEN_FAILED', 'DB_CORRUPT', 'MIGRATION_FAILED']).toContain(
        backend.ready.error.code,
      );
    }
    expect(await backend.waitForExit(5000)).toBe(1);
  });

  it('restarts against an existing database without making a copy', async () => {
    const secret = randomBytes(32).toString('hex');
    const dataDir = tempDir();

    const first = await start(['--data-dir', dataDir, '--stdin-lifeline'], {
      COMPINTEL_CLIENT_SECRET: secret,
    });
    first.child.stdin.end();
    expect(await first.waitForExit(5000)).toBe(0);

    const second = await start(['--data-dir', dataDir, '--stdin-lifeline'], {
      COMPINTEL_CLIENT_SECRET: secret,
    });
    expect(second.ready.ready).toBe(true);
    expect(readdirSync(path.join(dataDir, 'backups-local'))).toStrictEqual([]);
    second.child.stdin.end();
    expect(await second.waitForExit(5000)).toBe(0);
  });
});

describe('graceful shutdown', () => {
  it('exits 0 within 5 s when stdin reaches EOF and --stdin-lifeline is set', async () => {
    const backend = await start(['--data-dir', tempDir(), '--stdin-lifeline'], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });

    const startedAt = Date.now();
    backend.child.stdin.end();
    expect(await backend.waitForExit(5000)).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('ignores stdin EOF without the flag', async () => {
    const secret = randomBytes(32).toString('hex');
    const backend = await start(['--data-dir', tempDir()], { COMPINTEL_CLIENT_SECRET: secret });

    backend.child.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 750));
    const response = await fetch(`${baseUrlOf(backend)}/api/v1/health`, {
      headers: { 'X-CompIntel-Client': secret },
    });
    expect(response.status).toBe(200);
  });

  it('exits 0 after POST /system/shutdown', async () => {
    const secret = randomBytes(32).toString('hex');
    const backend = await start(['--data-dir', tempDir()], { COMPINTEL_CLIENT_SECRET: secret });

    const response = await fetch(`${baseUrlOf(backend)}/api/v1/system/shutdown`, {
      method: 'POST',
      headers: { 'X-CompIntel-Client': secret },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toStrictEqual({ accepted: true });
    expect(await backend.waitForExit(5000)).toBe(0);
  });

  it('refuses POST /system/shutdown without the secret and stays up', async () => {
    const secret = randomBytes(32).toString('hex');
    const backend = await start(['--data-dir', tempDir()], { COMPINTEL_CLIENT_SECRET: secret });

    const denied = await fetch(`${baseUrlOf(backend)}/api/v1/system/shutdown`, { method: 'POST' });
    expect(denied.status).toBe(401);

    const alive = await fetch(`${baseUrlOf(backend)}/api/v1/health`, {
      headers: { 'X-CompIntel-Client': secret },
    });
    expect(alive.status).toBe(200);
  });

  // Windows has no POSIX signals: `child.kill('SIGTERM')` calls TerminateProcess,
  // so the SIGINT/SIGTERM/SIGBREAK handlers cannot be exercised from a parent
  // process here. They still matter for a console Ctrl+C; the shell's own path is
  // stdin EOF plus the Job Object (ADR-0001, A17), which the tests above cover.
  it('dies when the parent terminates it', async () => {
    const backend = await start(['--data-dir', tempDir()], {
      COMPINTEL_CLIENT_SECRET: randomBytes(32).toString('hex'),
    });
    backend.child.kill('SIGTERM');
    await backend.waitForExit(5000);
    expect(backend.child.exitCode !== null || backend.child.signalCode !== null).toBe(true);
  });
});

/** The log file for today, named the way the rotating destination names it. */
function logFileName(): string {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `backend-${now.getFullYear().toString()}-${month}-${day}.log`;
}
