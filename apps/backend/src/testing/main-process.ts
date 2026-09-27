import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { spawnBackend, type BackendProcess } from './backend-process.js';
import { makeTempDir, removeTempDir } from './temp.js';

/**
 * Running `src/main.ts` as a real child process, for the suites that test the
 * process rather than the app inside it (ruling R7, R14, R15).
 *
 * Extracted in pre-M2a so those cases could be split across three files. They are
 * the slowest thing in `pnpm verify` — every case pays ~2 s for a node start, a
 * tsx transform and every migration, and eighteen of them in one file was 40 s of
 * strictly serial time that no amount of workers could overlap. Three files run
 * at once; the work is the same and the wall clock is a third of it (R89).
 */

const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));
// `--import` needs a file:// URL on Windows, not a drive-letter path.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const temps: string[] = [];
const running: BackendProcess[] = [];

/** A data directory for one case, removed by {@link stopMainProcesses}. */
export function mainTempDir(): string {
  const dir = makeTempDir('main');
  temps.push(dir);
  return dir;
}

/** Runs `src/main.ts` the way the shell runs the bundle: a real child process. */
export function startMain(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<BackendProcess> {
  return spawnBackend({
    command: process.execPath,
    args: ['--import', TSX, MAIN, ...args],
    env: { PORT: '0', ...env },
  }).then((backend) => {
    running.push(backend);
    return backend;
  });
}

/** Every `afterEach` in these suites: nothing outlives its case. */
export function stopMainProcesses(): void {
  while (running.length > 0) {
    running.pop()?.child.kill();
  }
  while (temps.length > 0) {
    removeTempDir(temps.pop() ?? '');
  }
}

/** How many migrations this build ships, read from the journal the migrator uses. */
export function journalEntryCount(): number {
  const journal = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, '..', '..', 'migrations', 'meta', '_journal.json'),
      'utf8',
    ),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

/** The log file for today, named the way the rotating destination names it. */
export function logFileName(): string {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `backend-${now.getFullYear().toString()}-${month}-${day}.log`;
}
