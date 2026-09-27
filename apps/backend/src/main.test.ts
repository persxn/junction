import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { HealthResponse, ReadyLine } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { baseUrlOf } from './testing/backend-process.js';
import {
  journalEntryCount,
  logFileName,
  mainTempDir as tempDir,
  startMain as start,
  stopMainProcesses,
} from './testing/main-process.js';

/**
 * The startup handshake and a failed start (ruling R7): the one line the process
 * writes to stdout, and what it says when it cannot start at all.
 *
 * The other process suites are `main-database.test.ts` and
 * `main-shutdown.test.ts`. They were one file until pre-M2a; eighteen serial
 * spawns were the longest single thing in `pnpm verify` (R89).
 */

afterEach(() => {
  stopMainProcesses();
});

// Each case spawns a real backend through tsx: a transform of the whole backend
// plus every migration, about 2 s. It used to ask for 60 s, because under a
// sixteen-worker run a starved spawn had reached 22 s — which ruling R89 calls a
// finding rather than a timeout to raise. The finding was the worker count
// (vitest.config.ts) and eighteen spawns in one file; both are fixed, so this
// suite lives inside the 20 s ceiling like everything else in `pnpm verify`.
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
