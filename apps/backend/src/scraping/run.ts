import type { ScrapeOutcome, ScrapeTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { ScrapeRunRow, SourceRow } from '../db/schema/index.js';
import { backoffDelayMs } from '../domain/scheduling.js';
import { DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS } from '../jobs/types.js';
import type { SourceRecordsRepository } from '../modules/sources/records.js';
import type { SourcesRepository, RunTotals } from '../modules/sources/repository.js';
import { nowMs, type Clock } from '../platform/time.js';
import type { SourceAdapter } from '../sources/types.js';
import { AdapterFormatError, pausesSource, toRunFailure, type RunFailure } from './errors.js';
import type { ScrapingHttp, SourceCredential } from './http/index.js';
import { processItem, type RecordLinker } from './items.js';
import type { SnapshotStore } from './snapshots.js';
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

export interface ScrapeRunDependencies {
  readonly sources: SourcesRepository;
  readonly records: SourceRecordsRepository;
  readonly http: ScrapingHttp;
  readonly snapshots?: SnapshotStore;
  readonly clock: Clock;
  readonly logger: Logger;
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

interface Counters {
  itemsSeen: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsInvalid: number;
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

      if (!listed.changed || adapter.detail === undefined || !canFetchDetail) {
        continue;
      }
      detailsLeft -= 1;
      const detail = await adapter.detail(itemOptions.context, item);
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
    failure,
    requestsMade: client.requestsMade,
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

/** Bumps the counter an upsert outcome belongs to. */
function count(counters: Counters, outcome: 'NEW' | 'UPDATED' | 'UNCHANGED'): void {
  if (outcome === 'NEW') {
    counters.itemsNew += 1;
  } else if (outcome === 'UPDATED') {
    counters.itemsUpdated += 1;
  } else {
    counters.itemsUnchanged += 1;
  }
}

/** A run that never started: no requests, no state change, but a row all the same. */
function closeImmediately(
  deps: ScrapeRunDependencies,
  source: SourceRow,
  trigger: ScrapeTrigger,
  startedAt: number,
  outcome: Extract<ScrapeOutcome, 'BLOCKED_BY_POLICY' | 'SKIPPED_OFFLINE' | 'SKIPPED_BACKOFF'>,
  failure: RunFailure | undefined,
): ScrapeRunRow {
  const run = deps.sources.openRun(source.id, trigger, startedAt);
  const totals: RunTotals = {
    outcome,
    errorKind: failure?.kind ?? null,
    errorDetail: failure?.message ?? null,
    listingComplete: false,
    requestsMade: 0,
    itemsSeen: 0,
    itemsNew: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsInvalid: 0,
  };
  deps.logger.info({ source: source.key, outcome }, 'scrape run skipped');
  return deps.sources.closeRun(run.id, nowMs(deps.clock), startedAt, totals);
}

interface FinishInput {
  readonly source: SourceRow;
  readonly run: ScrapeRunRow;
  readonly startedAt: number;
  readonly counters: Counters;
  readonly listingComplete: boolean;
  readonly failure: RunFailure | undefined;
  readonly requestsMade: number;
  readonly robotsFetches: number;
}

/**
 * Closes the run, updates `source_state` and applies §7.6.
 *
 * Which outcome a run gets is the one decision worth reading twice. A refusal by
 * the gate is `BLOCKED_BY_POLICY`, never a failure. A failure that happened
 * after some items had already been written is `PARTIAL`, because the data that
 * did land is real. A clean walk that the adapter did not call complete is also
 * `PARTIAL`: §7.6 counts only complete runs towards MISSING, and a run that
 * stopped at a cap has not proved anything is gone.
 */
function finish(deps: ScrapeRunDependencies, input: FinishInput): ScrapeRunRow {
  const { source, counters, failure } = input;
  const finishedAt = nowMs(deps.clock);
  const wrote = counters.itemsNew + counters.itemsUpdated + counters.itemsUnchanged > 0;

  let outcome: ScrapeOutcome;
  if (failure === undefined) {
    outcome = input.listingComplete ? 'SUCCESS' : 'PARTIAL';
  } else if (failure.refusal !== undefined) {
    outcome = 'BLOCKED_BY_POLICY';
  } else {
    outcome = wrote ? 'PARTIAL' : 'FAILED';
  }

  const row = deps.sources.closeRun(input.run.id, finishedAt, input.startedAt, {
    outcome,
    errorKind: failure?.kind ?? null,
    errorDetail: failure?.message ?? null,
    // A failed run never claims a complete walk, whatever the adapter reported
    // before it threw.
    listingComplete: failure === undefined && input.listingComplete,
    requestsMade: input.requestsMade,
    ...counters,
  });

  if (outcome === 'FAILED' || outcome === 'BLOCKED_BY_POLICY') {
    const failures = deps.sources.state(source.id, input.startedAt).consecutiveFailures + 1;
    const backoffUntil =
      finishedAt + backoffDelayMs(failures, DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS);
    deps.sources.recordFailure(
      source.id,
      finishedAt,
      backoffUntil,
      failure?.kind ?? 'UNKNOWN',
      failure?.message ?? 'The run failed.',
      failures,
    );
  } else {
    const nextDueAt = finishedAt + source.cadenceMinutes * 60_000;
    // §7.6 again: PARTIAL updates `last_run_at` but is not proof the source is
    // healthy, so it does not stamp `last_success_at`.
    deps.sources.recordSuccess(source.id, finishedAt, nextDueAt, outcome === 'SUCCESS');
  }

  // Only a complete run may age a record out (§7.6).
  const marked = row.listingComplete ? deps.records.markMissing(source.id, finishedAt) : 0;

  if (failure !== undefined && pausesSource(failure.kind)) {
    deps.sources.pause(source.id, finishedAt);
    deps.logger.warn(
      { source: source.key, kind: failure.kind },
      'the source format changed, so the source is paused until an administrator re-enables it',
    );
  }

  deps.snapshots?.prune();
  deps.logger.info(
    {
      source: source.key,
      outcome,
      errorKind: row.errorKind,
      listingComplete: row.listingComplete,
      requestsMade: row.requestsMade,
      robotsFetches: input.robotsFetches,
      items: counters,
      markedMissing: marked,
      durationMs: row.durationMs,
    },
    'scrape run finished',
  );
  return row;
}
