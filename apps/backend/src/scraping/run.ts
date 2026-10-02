import type { ScrapeTrigger } from '@compintel/contracts';

import type { ScrapeRunRow, SourceRow } from '../db/schema/index.js';
import { nowMs } from '../platform/time.js';
import type { SourceAdapter } from '../sources/types.js';
import { AdapterFormatError, toRunFailure, type RunFailure } from './errors.js';
import {
  closeImmediately,
  count,
  finish,
  type Counters,
  type RunCloseDependencies,
} from './finish.js';
import type { ScrapingHttp, SourceCredential } from './http/index.js';
import { processItem, type RecordLinker } from './items.js';
import { policyRefusal } from './policy.js';
import { missingCredentialDetail, sourceConfig, sourceRequestContext } from './source-row.js';

/**
 * The scrape orchestrator (§7's pipeline, §7.6, §7.7).
 *
 * It is the only thing that writes a `scrape_runs` row, and it writes one for
 * every attempt — including the ones that made no request at all. A run that was
 * skipped because the machine was offline, or refused because the source is
 * MANUAL_IMPORT_ONLY, leaves the same kind of evidence as one that failed on a
 * timeout. "Nothing happened and we do not know why" is not an answer Source
 * status is allowed to give.
 *
 * The order of the three guards at the top is the order in which they stop being
 * our business. The compliance gate is a decision about what we are *allowed* to
 * do and is checked first, so a source that may not be scraped never reaches the
 * code that would ask whether the network is up.
 */

/**
 * The snapshot "record" a format failure is filed under. Not a record id — no
 * record exists — but it gives §7.8's three-per-record limit something to count,
 * so the newest three broken bodies are the ones kept.
 */
export const FAILED_BODY_RECORD = 'format-failure';

/** How many detail fetches one run may make when the source does not say. */
export { DEFAULT_DETAIL_CAP } from './source-row.js';

/** Closing a run lives in `finish.ts`; these are its names, re-exported. */
export type { RunFinished, RunCloseDependencies } from './finish.js';

export interface ScrapeRunDependencies extends RunCloseDependencies {
  readonly http: ScrapingHttp;
  readonly setupComplete: () => boolean;
  /** WP-10: turns each stored record into an event, in the item's transaction. */
  readonly linker?: RecordLinker;
  /** WP-11: a source's API credential from the secret settings, when it has one set. */
  readonly credentials?: (source: SourceRow) => SourceCredential | undefined;
}

export interface ScrapeRunRequest {
  readonly source: SourceRow;
  readonly adapter: SourceAdapter;
  readonly trigger: ScrapeTrigger;
  readonly signal?: AbortSignal;
}

/** Runs one source once and returns the closed `scrape_runs` row. */
export async function runScrape(
  deps: ScrapeRunDependencies,
  request: ScrapeRunRequest,
): Promise<ScrapeRunRow> {
  const { source, adapter, trigger } = request;
  const startedAt = nowMs(deps.clock);
  const signal = request.signal ?? new AbortController().signal;
  const config = sourceConfig(source);
  const credential = deps.credentials?.(source);
  const context = sourceRequestContext(source, credential);

  const refusal = policyRefusal(deps.setupComplete(), source, context);
  if (refusal !== undefined) {
    return closeImmediately(deps, source, trigger, startedAt, 'BLOCKED_BY_POLICY', refusal);
  }
  // WP-11: a missing API key is a state of the source, not a failure — zero
  // requests, no backoff, no streak, and the job stays on its cadence (U4).
  const missing = credential === undefined ? missingCredentialDetail(source) : undefined;
  if (missing !== undefined) {
    const blocked = {
      kind: 'BLOCKED' as const,
      message: missing,
      refusal: undefined,
      pausesSource: false,
    };
    const row = closeImmediately(deps, source, trigger, startedAt, 'BLOCKED_BY_POLICY', blocked);
    deps.sources.recordBlocked(
      source.id,
      startedAt,
      startedAt + source.cadenceMinutes * 60_000,
      'BLOCKED',
      missing,
    );
    return row;
  }

  const client = deps.http.clientFor(context, signal);
  if (!client.isOnline()) {
    // D-23: offline is not a failure, so the streak and the backoff are left
    // exactly as they were.
    return closeImmediately(deps, source, trigger, startedAt, 'SKIPPED_OFFLINE', undefined);
  }

  const state = deps.sources.state(source.id, startedAt);
  if (state.backoffUntil !== null && state.backoffUntil > startedAt) {
    return closeImmediately(deps, source, trigger, startedAt, 'SKIPPED_BACKOFF', undefined);
  }

  const run = deps.sources.openRun(source.id, trigger, startedAt);
  const counters: Counters = {
    itemsSeen: 0,
    itemsNew: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsInvalid: 0,
  };
  let listingComplete = false;
  let listingNotModified = false;
  let failure: RunFailure | undefined;

  const itemOptions = {
    source,
    adapter,
    context: {
      http: client,
      log: deps.logger.child({ source: source.key }),
      clock: deps.clock,
      now: () => deps.clock.now(),
      signal,
      config: config.raw,
      isKnown: (externalKey: string) => deps.records.find(source.id, externalKey) !== undefined,
    },
    normalizeContext: {
      clock: deps.clock,
      sourceKey: source.key,
      defaultTimeZone: config.defaultTimeZone,
    },
    records: deps.records,
    snapshots: deps.snapshots,
    logger: deps.logger,
    at: startedAt,
    linker: deps.linker,
  };

  let detailsLeft = adapter.detail === undefined ? 0 : config.detailCap;
  // WP-12: a detail owed but not fetched this run — the cap, or a subdomain's
  // robots.txt — leaves the listing complete but the run PARTIAL.
  let degraded = false;
  try {
    const walk = adapter.listing(itemOptions.context);
    for (;;) {
      const next = await walk.next();
      if (next.done === true) {
        listingComplete = next.value?.complete ?? false;
        listingNotModified = next.value?.notModified ?? false;
        break;
      }
      const item = next.value;
      counters.itemsSeen += 1;

      // A detail fetch is owed when the listing hash moved and the adapter has a
      // detail step. Whether it happens in *this* run is a budget question, and
      // the answer is written into the row so `detail-refresh` can finish the
      // job (§7.2: "the remainder continues next run").
      const canFetchDetail = detailsLeft > 0 && client.requestsRemaining > 0;
      const listed = processItem(item, {
        ...itemOptions,
        detailPending: (changed) => changed && adapter.detail !== undefined && !canFetchDetail,
      });
      if (listed.outcome === 'INVALID') {
        counters.itemsInvalid += 1;
        continue;
      }
      count(counters, listed.outcome);

      if (!listed.changed || adapter.detail === undefined) {
        continue;
      }
      if (!canFetchDetail) {
        degraded = true;
        continue;
      }
      detailsLeft -= 1;
      // R75: a stored event's detail page may be read signed in, if the adapter
      // asks; a new one's may not, and nothing may in a catch-up burst.
      const targeted = listed.outcome !== 'NEW' && trigger !== 'STARTUP_CATCHUP';
      const detail = await adapter.detail(
        { ...itemOptions.context, http: client.signedInView(targeted) },
        item,
      );
      degraded ||= detail.degraded === true;
      // A detail that does not validate is counted invalid, but the listing row
      // it would have replaced stays: half an event is better than none, and the
      // counter is what tells an admin the detail step is drifting.
      const applied = processItem(
        item,
        { ...itemOptions, detailPending: () => false },
        detail.payload,
      );
      if (applied.outcome === 'INVALID') {
        counters.itemsInvalid += 1;
      }
    }
  } catch (error) {
    failure = toRunFailure(error);
    keepFailedBody(deps, source.key, error);
  }

  if (failure === undefined && listingNotModified) {
    // A 304 costs no parse and no write beyond `last_seen_at` (R58). Every
    // record the source still lists is unchanged, by definition.
    const touched = deps.records.touchAll(source.id, startedAt);
    counters.itemsSeen += touched;
    counters.itemsUnchanged += touched;
  }

  return finish(deps, {
    source,
    run,
    startedAt,
    counters,
    listingComplete,
    degraded,
    failure,
    requestsMade: client.requestsMade,
    signedInRequests: client.signedInRequestsMade,
    sessionRejected: client.sessionRejected,
    robotsFetches: deps.http.robotsFetches,
  });
}

/**
 * The snapshot a format failure leaves behind (§7.8). Nothing else of the run
 * was written, so these bytes are the only evidence of what the source now
 * sends — and what the adapter's fixture is regenerated from.
 */
function keepFailedBody(deps: ScrapeRunDependencies, sourceKey: string, error: unknown): void {
  if (!(error instanceof AdapterFormatError) || error.raw === undefined) {
    return;
  }
  const ref = deps.snapshots?.write(sourceKey, FAILED_BODY_RECORD, error.raw);
  deps.logger.warn({ source: sourceKey, snapshot: ref }, 'the body that failed to parse was kept');
}
