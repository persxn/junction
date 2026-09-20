import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

/** Best-effort removal; a file still held open must not fail a passing test. */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Windows keeps a handle for a moment after close; the next run reuses the root.
  }
}
