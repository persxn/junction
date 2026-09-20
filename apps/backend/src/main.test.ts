import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { HealthResponse, ReadyLine } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { baseUrlOf, spawnBackend, type BackendProcess } from './testing/backend-process.js';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
// `--import` needs a file:// URL on Windows, not a drive-letter path.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const temps: string[] = [];
const running: BackendProcess[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'compintel-main-'));
  temps.push(dir);
  return dir;
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
    rmSync(temps.pop() ?? '', { recursive: true, force: true });
  }
});

describe('startup handshake', () => {
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
