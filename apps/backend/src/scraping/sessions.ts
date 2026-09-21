import type { Logger } from 'pino';

import type { SourceRow } from '../db/schema/index.js';
import {
  expiredDetail,
  markSessionExpired,
  markSessionVerified,
  resolveSessionCredential,
  sessionIsSet,
} from '../modules/sources/session.js';
import type { SourcesRepository } from '../modules/sources/repository.js';
import type { SettingsStore } from '../platform/settings.js';

/**
 * What a scrape run may do to the professor's stored session (R74/D-34, WP-14).
 *
 * An expired session is a **state of the source**, not a failure. The run
 * records BLOCKED with the sentence Source status shows, the cookie stops being
 * sent, the next run reads the public pages — and the failure streak and the
 * backoff ladder are left exactly where they were. Nothing is wrong with the
 * site; our sign-in lapsed, and backing the site off for that would be punishing
 * it for our problem.
 */

export interface SessionHooks {
  /** Whether this run sent the professor's session. */
  isActive(source: SourceRow): boolean;
  /** Marks it expired; false when there was none to expire. */
  expire(source: SourceRow, at: number): boolean;
  /** A run used it and was not refused. */
  verify(source: SourceRow, at: number): void;
  /** The sentence §7.7 shows for an expired session. */
  expiredDetail(source: SourceRow): string;
}

/** The hooks over the real settings store; `main.ts` and the harnesses use this. */
export function createSessionHooks(settings: SettingsStore): SessionHooks {
  return {
    isActive: (source) => resolveSessionCredential(source, settings) !== undefined,
    expire: (source, at) => markSessionExpired(source, settings, at),
    verify: (source, at) => {
      markSessionVerified(source, settings, at);
    },
    expiredDetail,
  };
}

/** Whether a session is stored at all, expired or not. */
export function hasStoredSession(source: SourceRow, settings: SettingsStore): boolean {
  return sessionIsSet(source, settings);
}

/**
 * The run's whole answer to "the site refused a signed-in read": expire the
 * session, say so in §7.7's words, and leave the streak alone.
 */
export function recordSessionExpiry(
  deps: { sources: SourcesRepository; sessions: SessionHooks; logger: Logger },
  source: SourceRow,
  finishedAt: number,
): void {
  deps.sessions.expire(source, finishedAt);
  deps.sources.recordBlocked(
    source.id,
    finishedAt,
    finishedAt + source.cadenceMinutes * 60_000,
    'BLOCKED',
    deps.sessions.expiredDetail(source),
  );
  deps.logger.warn(
    { source: source.key },
    'the stored session was refused, so it is marked expired and the public pages are used from now on',
  );
}
