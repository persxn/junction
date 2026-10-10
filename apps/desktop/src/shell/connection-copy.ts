import {
  STARTUP_ERROR_CODES,
  type BackendPhase,
  type StartupErrorCode,
} from '@compintel/contracts';

/**
 * What the connection screen says, as a pure function of the shell's state.
 *
 * Ruling R26: a named startup error is terminal — no backoff loop, the message
 * shown verbatim, Retry the only way out — and DATA_DIR_LOCKED and DB_CORRUPT
 * get their own copy, because those two are the ones a user can actually fix.
 *
 * `BackendStatus` carries `lastError` as prose, not as a code, so the code is
 * recovered by looking for it in the message. That is deliberately forgiving: if
 * the shell's wording ever changes, the screen degrades to the generic copy plus
 * the verbatim message rather than showing the wrong instructions.
 */

export interface ConnectionCopy {
  readonly title: string;
  readonly body: string;
  /** What to do about it, when there is something to do. */
  readonly hint: string | undefined;
  /** Whether the Retry button is worth offering. */
  readonly canRetry: boolean;
  /** Whether this is a failure or just a wait. */
  readonly tone: 'info' | 'danger';
}

/** Finds a `StartupErrorCode` inside the shell's message, if it named one. */
export function startupErrorCode(message: string | null | undefined): StartupErrorCode | undefined {
  if (message === null || message === undefined) {
    return undefined;
  }
  return STARTUP_ERROR_CODES.find((code) => message.includes(code));
}

const TERMINAL_COPY: Partial<
  Record<StartupErrorCode, { readonly title: string; readonly body: string; readonly hint: string }>
> = {
  DATA_DIR_LOCKED: {
    title: 'Another Junction is already using this data folder',
    body: 'Only one copy of Junction can use a data folder at a time, so that two of them cannot write over each other.',
    hint: 'Close the other Junction window — check the notification area next to the clock — and then try again.',
  },
  DB_CORRUPT: {
    title: 'The database could not be opened',
    body: 'The database file failed its integrity check, so Junction stopped rather than write anything more to it.',
    hint: 'Restore the most recent backup from the backups folder, then try again. Your backups are untouched.',
  },
  MIGRATION_FAILED: {
    title: 'The database could not be upgraded',
    body: 'An upgrade step failed, so the database was left exactly as it was — nothing was half-applied.',
    hint: 'Copy the diagnostics and open the logs; the failing step is named there.',
  },
};

export function connectionCopy(
  phase: BackendPhase | undefined,
  message: string | null | undefined,
): ConnectionCopy {
  if (phase === 'FAILED') {
    const code = startupErrorCode(message);
    const known = code === undefined ? undefined : TERMINAL_COPY[code];
    if (known !== undefined) {
      return { ...known, canRetry: true, tone: 'danger' };
    }
    return {
      title: 'The background service stopped',
      // R26: whatever the shell said, said verbatim.
      body: message ?? 'It stopped too often for Junction to keep restarting it.',
      hint: 'Open the logs to see what happened, then try again.',
      canRetry: true,
      tone: 'danger',
    };
  }
  if (phase === 'RESTARTING') {
    return {
      title: 'Reconnecting to the background service',
      body: 'It stopped unexpectedly and Junction is starting it again. Scraping and reminders resume by themselves.',
      hint: undefined,
      canRetry: false,
      tone: 'info',
    };
  }
  if (phase === 'STOPPING' || phase === 'STOPPED') {
    return {
      title: 'Closing Junction',
      body: 'The background service is shutting down cleanly.',
      hint: undefined,
      canRetry: false,
      tone: 'info',
    };
  }
  return {
    title: 'Starting Junction',
    body: 'The background service is starting. This takes a moment the first time after an update.',
    hint: undefined,
    canRetry: false,
    tone: 'info',
  };
}
