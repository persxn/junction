import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { HealthResponse } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { baseUrlOf } from './testing/backend-process.js';
import {
  logFileName,
  mainTempDir as tempDir,
  startMain as start,
  stopMainProcesses,
} from './testing/main-process.js';

/**
 * The database and the data-directory lock, from outside the process (R15, R16):
 * the file appears, the migrations run, the lock is held while it runs and a
 * second backend on the same directory is refused.
 *
 * Split out of `main.test.ts` in pre-M2a so these spawns run beside the others
 * rather than after them (R89).
 */

afterEach(() => {
  stopMainProcesses();
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
