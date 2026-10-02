import type { ScrapeMethod } from '@compintel/contracts';

import { hostAllowed } from '../../domain/scraping/paths.js';
import { decideSignedIn, signedInWaitMs } from '../../domain/scraping/signed-in.js';
import { applyJitter } from '../../domain/scheduling.js';
import { classifyStatus, parseRetryAfter } from './classify.js';
import type { HttpEnvironment } from './polite-client.js';
import { header } from './read.js';
import type { RunLedger } from './run-ledger.js';
import {
  DEFAULT_SIGNED_IN_BUDGET,
  MAX_RETRIES,
  RETRY_BASE_MS,
  RETRYABLE_ERROR_KINDS,
  ScrapeRequestError,
  type RequestOptions,
  type SourceRequestContext,
  type TransportResponse,
} from './types.js';

/**
 * The three per-attempt rules the polite client applies, kept beside it rather
 * than inside it: whether this attempt carries the session (R75), how long to
 * wait before another (§7.2), and what a 4xx/5xx is recorded as. Each is a
 * decision about one attempt and nothing else, which is why they lift out
 * cleanly.
 */

export interface GrantInput {
  readonly env: Pick<HttpEnvironment, 'clock' | 'sleep' | 'logger'>;
  readonly source: SourceRequestContext;
  readonly ledger: RunLedger;
  /** Whether the client view is one R75 allows signed-in reading in. */
  readonly scope: boolean;
}

/**
 * R75's answer for one attempt: true to send the session. Waits out the
 * ten-second spacing before saying yes, and throws when the run's signed-in
 * allowance is spent.
 */
export async function grantSignedIn(
  input: GrantInput,
  url: URL,
  options: RequestOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const { env, source, ledger } = input;
  const session = source.session;
  const budget = session?.budget ?? DEFAULT_SIGNED_IN_BUDGET;
  const decision = decideSignedIn({
    asked: options.access === 'signed-in',
    sessionUsable: session !== undefined && !ledger.sessionRejected,
    hostMatches: session?.hosts !== undefined && hostAllowed(url.hostname, session.hosts),
    scopeAllows: input.scope,
    made: ledger.signedInMade,
    maxPerRun: budget.maxRequests,
  });
  if (decision.send === 'refused') {
    throw new ScrapeRequestError({
      kind: 'BLOCKED',
      message: decision.reason,
      refusal: 'SIGNED_IN_BUDGET_SPENT',
    });
  }
  if (decision.send === 'anonymous') {
    if (decision.reason === 'SCOPE') {
      env.logger.debug(
        { source: source.key, url: url.toString() },
        'a signed-in read was asked for outside a targeted scope, so it was made anonymously (R75)',
      );
    }
    return false;
  }
  const wait = signedInWaitMs(
    ledger.lastSignedInAt,
    env.clock.now().getTime(),
    budget.minIntervalMs,
  );
  if (wait > 0) {
    await env.sleep(wait, signal);
  }
  return true;
}

/**
 * How long to wait before trying again, or `undefined` for "do not".
 *
 * `Retry-After` wins where the server sent one, and a wait the run cannot
 * afford ends the request as `RATE_LIMITED` rather than being silently
 * shortened — asking again sooner than we were told to is the opposite of
 * honouring it.
 *
 * Every other retry waits the larger of the exponential step and the host's
 * effective delay. A retry is another request, so the crawl-delay applies to
 * it exactly as it does to a first attempt; with §7.2's 3-second floor that
 * makes the first step 3 s rather than 2 s.
 */
export function retryDelay(
  error: ScrapeRequestError,
  attempt: number,
  delayMs: number,
  maxWaitMs: number,
  random: () => number,
): number | undefined {
  if (attempt >= MAX_RETRIES) {
    return undefined;
  }
  if (error.kind === 'RATE_LIMITED') {
    const asked = error.retryAfterMs;
    if (asked === undefined) {
      return undefined;
    }
    return asked <= maxWaitMs ? Math.max(asked, delayMs) : undefined;
  }
  if (!RETRYABLE_ERROR_KINDS.includes(error.kind)) {
    return undefined;
  }
  return Math.max(applyJitter(RETRY_BASE_MS * 2 ** attempt, 0.25, random), delayMs);
}

/** What a 4xx/5xx answer is recorded as, with any `Retry-After` it carried. */
export function statusError(
  response: TransportResponse,
  target: string,
  method: ScrapeMethod,
  now: Date,
): ScrapeRequestError {
  const kind = classifyStatus(response.status);
  const retryAfterMs = parseRetryAfter(header(response, 'retry-after'), now);
  return new ScrapeRequestError({
    kind,
    status: response.status,
    message: `${method} ${target} answered ${response.status}.`,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}
