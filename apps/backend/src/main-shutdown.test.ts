import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { baseUrlOf } from './testing/backend-process.js';
import {
  mainTempDir as tempDir,
  startMain as start,
  stopMainProcesses,
} from './testing/main-process.js';

/**
 * Stopping the process (ruling R14, A17): stdin EOF with and without the
 * lifeline flag, the shutdown route, and being terminated by the parent.
 *
 * Split out of `main.test.ts` in pre-M2a so these spawns run beside the others
 * rather than after them (R89).
 */

afterEach(() => {
  stopMainProcesses();
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
