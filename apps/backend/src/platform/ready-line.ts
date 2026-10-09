import type { ReadyLine } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { App } from '../app.js';
import { StartupError, toStartupFailure } from './startup-error.js';

/**
 * What `main.ts` tells the shell (ruling R7): the READY line, or the failure
 * that replaced it. Moved out of `main.ts` (WP-24) to keep it under 400 lines.
 */

/**
 * The one and only thing this process writes to stdout (ruling R7). The callback
 * form matters: stdout is a pipe when the shell spawns us, so the line must be
 * flushed before `process.exit`.
 */
export function writeReadyLine(line: ReadyLine): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(line)}\n`, () => {
      resolve();
    });
  });
}

export async function failStart(error: unknown, logger?: Logger): Promise<never> {
  const failure = toStartupFailure(error);
  logger?.fatal({ err: error, code: failure.code }, 'backend failed to start');
  await writeReadyLine({ ready: false, error: failure });
  process.exit(1);
}

export function listeningPort(app: App): number {
  const address = app.server.server.address();
  if (address === null || typeof address !== 'object') {
    throw new StartupError('LISTEN_FAILED', 'The server reported no TCP address after listening.');
  }
  return address.port;
}
