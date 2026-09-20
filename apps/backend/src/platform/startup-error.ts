import type { StartupErrorCode } from '@compintel/contracts';

/**
 * A failure that happens before the HTTP server is listening. `main.ts` turns it
 * into the `{"ready":false,...}` line on stdout and exits 1; the shell shows the
 * message and applies its restart backoff (ADR-0001).
 */
export class StartupError extends Error {
  readonly code: StartupErrorCode;

  constructor(code: StartupErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StartupError';
    this.code = code;
  }
}

/** Narrows an unknown throw to a startup code + message, defaulting to STARTUP_FAILED. */
export function toStartupFailure(error: unknown): { code: StartupErrorCode; message: string } {
  if (error instanceof StartupError) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'STARTUP_FAILED', message: message.length > 0 ? message : 'Unknown failure' };
}
