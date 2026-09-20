import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * `%LOCALAPPDATA%\CompIntel-dev`. CLAUDE.md keeps every byte of dev data out of
 * the repository, and tests are dev data too: a temp directory under the system
 * temp folder would work, but it would also hide a data directory somewhere the
 * user never looks.
 */
export function devRoot(): string {
  const localAppData = process.env.LOCALAPPDATA;
  const base =
    localAppData !== undefined && localAppData.length > 0
      ? localAppData
      : path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev');
}

/** Parent of every directory {@link makeTempDir} hands out. */
export function testTempRoot(): string {
  return path.join(devRoot(), 'test-tmp');
}

/**
 * A fresh directory under `%LOCALAPPDATA%\CompIntel-dev\test-tmp`, plus the
 * cleanup for it. Tests collect the returned paths and remove them in `afterEach`.
 */
export function makeTempDir(prefix = 'wp'): string {
  const root = testTempRoot();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, `${prefix}-`));
}

/** How long {@link removeDirectory} keeps trying before it gives up. */
export const REMOVE_TIMEOUT_MS = 2_000;

/**
 * Removes a directory, retrying while Windows lets go of it.
 *
 * SQLite closes its file before the handle is actually released, so a delete
 * that runs immediately after a backend exits hits `EBUSY` or `EPERM` on files
 * that are, as far as the process is concerned, closed. `rmSync`'s own
 * `maxRetries` covers the first few milliseconds; a process that has just been
 * killed can take longer than that, which is why this keeps going to a deadline.
 *
 * Returns whether the directory is gone, so a caller that cares — the bundle
 * smoke test, which leaves a whole staged installation behind — can say so
 * instead of silently leaking a directory every run.
 */
export function removeDirectory(dir: string, timeoutMs = REMOVE_TIMEOUT_MS): boolean {
  const deadline = Date.now() + timeoutMs;
  let delay = 20;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      return true;
    } catch (error) {
      if (!existsSync(dir)) {
        return true;
      }
      if (Date.now() >= deadline || !isTransient(error)) {
        return false;
      }
      // Synchronous on purpose: the callers are `afterEach` hooks and a CLI
      // tool, and making either of them async to wait for Windows would spread
      // through every test file that owns a temp directory.
      sleepSync(delay);
      delay = Math.min(delay * 2, 250);
    }
  }
}

/** The errors that mean "not yet", as opposed to "never". */
function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY' || code === 'EMFILE';
}

/** A real pause without a timer, because the callers are synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Best-effort removal for a test's own temp directory: a file still held open
 * must never fail a passing test. {@link removeDirectory} does the work.
 */
export function removeTempDir(dir: string): void {
  removeDirectory(dir);
}
