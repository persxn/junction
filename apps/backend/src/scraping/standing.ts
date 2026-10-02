import type { Logger } from 'pino';

import type { SourceRow } from '../db/schema/index.js';
import type { SourcesRepository } from '../modules/sources/repository.js';
import type { RunFailure } from './errors.js';
import type { SessionHooks } from './sessions.js';

/**
 * What a finished run does to a source's standing — rulings R79 and R80.
 *
 * Both are about the difference between "the site refused us" and "the site
 * refused our credential", and both end in a sentence on Source status rather
 * than in the failure streak:
 *
 * - **R80.** A refused API key or session is a state of the source. It counts
 *   toward neither the backoff ladder nor R79, the credential is not offered
 *   again until a person replaces it, and Source status says what to do.
 * - **R79.** One 403/WAF answer backs the source off (R60, WP-09a). Three
 *   finished runs in a row that the site refused set `compliance_status =
 *   BLOCKED` and switch the source off; only an administrator re-enables it.
 *
 * Skipped runs and our own gate's refusals say nothing about the site, so they
 * neither add to R79's count nor reset it.
 */

/** R79's threshold. */
export const BLOCKED_RUNS_BEFORE_PAUSE = 3;

export interface StandingDependencies {
  readonly sources: SourcesRepository;
  readonly sessions?: SessionHooks | undefined;
  readonly logger: Logger;
}

/** The sentence Source status shows once R79 has switched a source off. */
export function repeatedBlockDetail(source: SourceRow): string {
  return `${source.name} refused our requests ${BLOCKED_RUNS_BEFORE_PAUSE} runs in a row, so it is switched off until an administrator re-enables it.`;
}

/** The sentence Source status shows while a source's API key is refused (R80). */
export function refusedKeyDetail(source: SourceRow): string {
  return `${source.name} refused the API key — an administrator needs to enter a new one. Until then nothing is read from ${source.name}.`;
}

/** True for a failure that is the site refusing us, as R79 counts it. */
export function isSiteBlock(failure: RunFailure | undefined): boolean {
  return (
    failure?.kind === 'BLOCKED' && failure.refusal === undefined && failure.credential === undefined
  );
}

/**
 * R80 for a run that ended on a refused API key: the key is marked refused, the
 * run is recorded without a backoff or a streak, and Source status says so.
 */
export function recordRefusedKey(
  deps: StandingDependencies,
  source: SourceRow,
  failure: RunFailure,
  finishedAt: number,
): void {
  const detail = refusedKeyDetail(source);
  // A 401 is a key the site no longer accepts; a sign-in page is one it never did.
  deps.sources.setCredentialState(source.id, failure.status === 401 ? 'EXPIRED' : 'INVALID');
  deps.sources.recordBlocked(
    source.id,
    finishedAt,
    finishedAt + source.cadenceMinutes * 60_000,
    failure.kind,
    detail,
  );
  deps.sources.setNotice(source.id, detail);
  deps.logger.warn({ source: source.key }, 'the API key was refused; it is not sent again (R80)');
}

/**
 * R80 for a run during which the session was refused. The run itself went on
 * anonymously, so whatever outcome it earned stands; the session is marked
 * expired and Source status carries the sentence until the professor signs in.
 */
export function recordRefusedSession(
  deps: StandingDependencies,
  source: SourceRow,
  finishedAt: number,
): void {
  if (deps.sessions === undefined) {
    return;
  }
  deps.sessions.expire(source, finishedAt);
  deps.sources.setNotice(source.id, deps.sessions.expiredDetail(source));
  deps.logger.warn(
    { source: source.key },
    'the stored session was refused, so it is marked expired and the public pages are used from now on',
  );
}

/**
 * R79's count, after a run that reached the site. Returns true when this run
 * was the third block in a row and the source is now switched off.
 */
export function countBlocks(
  deps: StandingDependencies,
  source: SourceRow,
  failure: RunFailure | undefined,
  consecutiveBefore: number,
  finishedAt: number,
): boolean {
  if (failure?.refusal !== undefined || failure?.credential !== undefined) {
    return false;
  }
  if (!isSiteBlock(failure)) {
    if (consecutiveBefore !== 0) {
      deps.sources.setConsecutiveBlocked(source.id, 0);
    }
    return false;
  }
  const count = consecutiveBefore + 1;
  deps.sources.setConsecutiveBlocked(source.id, count);
  if (count < BLOCKED_RUNS_BEFORE_PAUSE) {
    return false;
  }
  deps.sources.blockAfterRepeatedRefusals(source, finishedAt, repeatedBlockDetail(source));
  deps.logger.warn(
    { source: source.key, consecutiveBlocked: count },
    'the source refused three runs in a row, so it is BLOCKED until an administrator re-enables it (R79)',
  );
  return true;
}
