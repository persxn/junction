import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';
import { z } from 'zod';

import type { Config } from './config.js';
import { StartupError } from './startup-error.js';

/** Name of the lock file inside the data directory (ruling R15). */
export const LOCK_FILE = 'backend.lock';

const LockBody = z.object({
  pid: z.int().min(1),
  startedAt: z.iso.datetime({ offset: true }),
});
type LockBody = z.infer<typeof LockBody>;

export interface DataDirLock {
  readonly file: string;
  readonly takenOverFrom: number | undefined;
  /** Removes the lock file, but only while it still names this process. */
  readonly release: () => void;
}

export function lockPath(config: Config): string {
  return path.join(config.dataDir, LOCK_FILE);
}

/**
 * Is this pid a process that still exists? Signal 0 performs the permission and
 * existence checks without delivering anything. `EPERM` means the process is
 * there but owned by someone else, which still counts as alive.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(file: string): LockBody | undefined {
  try {
    const parsed = LockBody.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeLock(file: string): void {
  const body: LockBody = { pid: process.pid, startedAt: new Date().toISOString() };
  const fd = openSync(file, 'w');
  try {
    writeSync(fd, JSON.stringify(body));
  } finally {
    closeSync(fd);
  }
}

/**
 * Ruling R15: exactly one backend per data directory. SQLite in WAL mode would
 * survive two writers on the same machine, but the job runner, the log file and
 * the LLM supervisor would not, so the process claims the directory explicitly.
 *
 * A lock whose pid is gone (a crash, or a kill that skipped our handlers) is
 * taken over with a warning rather than blocking the user out of their own data.
 */
export function acquireDataDirLock(config: Config, logger: Logger): DataDirLock {
  const file = lockPath(config);
  const existing = readLock(file);
  let takenOverFrom: number | undefined;

  if (existing !== undefined && existing.pid !== process.pid && isAlive(existing.pid)) {
    throw new StartupError(
      'DATA_DIR_LOCKED',
      `Another backend (pid ${existing.pid.toString()}, started ${existing.startedAt}) is already ` +
        `using "${config.dataDir}".`,
    );
  }
  if (existing !== undefined && existing.pid !== process.pid) {
    takenOverFrom = existing.pid;
    logger.warn(
      { file, stalePid: existing.pid, staleStartedAt: existing.startedAt },
      'taking over a stale data-dir lock; the previous backend did not shut down cleanly',
    );
  }

  try {
    writeLock(file);
  } catch (cause) {
    throw new StartupError(
      'DATA_DIR_UNUSABLE',
      `Cannot write the lock file "${file}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  let released = false;
  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    process.off('exit', release);
    const current = readLock(file);
    if (current === undefined || current.pid === process.pid) {
      rmSync(file, { force: true });
    }
  };

  // A hard exit (uncaught exception, shutdown timeout) must not leave a lock
  // behind that only the stale-takeover path can clear.
  process.once('exit', release);

  return { file, takenOverFrom, release };
}
