import type { ScrapeTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { SourceRow } from '../db/schema/index.js';
import type { SourceRecordsRepository } from '../modules/sources/records.js';
import type { SourcesRepository } from '../modules/sources/repository.js';
import { APP_TIMEZONE, nowMs, type Clock } from '../platform/time.js';
import {
  scheduledDetail,
  type AdapterContext,
  type ListingItem,
  type SourceAdapter,
} from '../sources/types.js';
import { toRunFailure, type RunFailure } from './errors.js';
import type { ScrapingHttp, SourceCredential } from './http/index.js';
import { processItem, type RecordLinker } from './items.js';
import type { SnapshotStore } from './snapshots.js';
import { sourceRequestContext } from './source-row.js';

/**
 * The overflow lane (§7.2: "detail fetches per run are capped; the remainder
 * continues next run").
 *
 * A listing run that found forty changed items and had budget for ten leaves
 * thirty records with `last_fetched_at < last_seen_at`. This picks them up,
 * oldest first, through the same politeness queue and the same compliance gate —
 * it is a different job, not a different set of rules.
 *
 * It touches **no `source_state`** and writes no *listing* run: §7.6 counts
 * those to decide what has gone missing, and Source status reads them to say
 * how fresh a source is. Since pre-M2b it does leave a `scrape_runs` row of
 * kind DETAIL_REFRESH per pass (WP-09a Q2), which claims no complete listing
 * and so is invisible to both.
 */

export interface DetailRefreshDependencies {
  readonly records: SourceRecordsRepository;
  readonly http: ScrapingHttp;
  readonly snapshots?: SnapshotStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** WP-10's linker, so a detail fetch updates the event too. */
  readonly linker?: RecordLinker;
  /**
   * The source's credential: its API key, or the professor's session (R74).
   * Every record here is a stored event, which is the one place R75 lets a
   * detail page be read signed in.
   */
  readonly credentials?: (source: SourceRow) => SourceCredential | undefined;
  /** Where the pass records its DETAIL_REFRESH row (WP-09a Q2). */
  readonly runs?: Pick<SourcesRepository, 'openRun' | 'closeRun'>;
}

export interface DetailRefreshResult {
  readonly attempted: number;
  readonly refreshed: number;
  readonly invalid: number;
  readonly failed: number;
}

/** Fetches up to `limit` owed details for one source. */
export async function refreshDetails(
  deps: DetailRefreshDependencies,
  source: SourceRow,
  adapter: SourceAdapter,
  limit: number,
  signal: AbortSignal,
  trigger: ScrapeTrigger = 'SCHEDULE',
): Promise<DetailRefreshResult> {
  const detailStep = scheduledDetail(adapter);
  if (detailStep === undefined) {
    return { attempted: 0, refreshed: 0, invalid: 0, failed: 0 };
  }
  const owed = deps.records.awaitingDetail(source.id, limit);
  if (owed.length === 0) {
    return { attempted: 0, refreshed: 0, invalid: 0, failed: 0 };
  }

  // R75: stored events only, so signed-in reading may be asked for — except in
  // the burst after the machine wakes, when nothing is read signed in.
  const client = deps.http
    .clientFor(sourceRequestContext(source, deps.credentials?.(source)), signal)
    .signedInView(trigger !== 'STARTUP_CATCHUP');
  const context: AdapterContext = {
    http: client,
    log: deps.logger.child({ source: source.key, job: 'detail-refresh' }),
    clock: deps.clock,
    now: () => deps.clock.now(),
    signal,
    config: parseConfig(source),
  };
  const at = nowMs(deps.clock);

  let refreshed = 0;
  let invalid = 0;
  let failed = 0;
  let failure: RunFailure | undefined;
  for (const record of owed) {
    if (client.requestsRemaining <= 0) {
      break;
    }
    // `payload` is the stored candidate rather than the original listing
    // payload, which is why `detail()` may only rely on `externalKey` and `url`
    // (see `sources/types.ts`).
    const item: ListingItem = {
      externalKey: record.externalKey,
      url: record.url,
      payload: safeJson(record.payloadJson),
    };
    try {
      const detail = await detailStep(context, item);
      const applied = processItem(
        item,
        {
          source,
          adapter,
          context,
          normalizeContext: {
            clock: deps.clock,
            sourceKey: source.key,
            defaultTimeZone: APP_TIMEZONE,
          },
          records: deps.records,
          snapshots: deps.snapshots,
          logger: deps.logger,
          at,
          linker: deps.linker,
          detailPending: () => false,
        },
        detail.payload,
      );
      if (applied.outcome === 'INVALID') {
        invalid += 1;
        // Stop it coming back every fifteen minutes; the listing run will offer
        // it again when the source actually changes it.
        deps.records.touch(record.id, at);
      } else {
        refreshed += 1;
      }
    } catch (error) {
      failed += 1;
      failure = toRunFailure(error);
      deps.logger.warn(
        { source: source.key, externalKey: record.externalKey, kind: failure.kind },
        'a detail fetch failed and will be retried next pass',
      );
      break;
    }
  }
  recordPass(
    deps,
    source,
    trigger,
    at,
    client.requestsMade,
    { refreshed, invalid, failed },
    failure,
  );
  return { attempted: owed.length, refreshed, invalid, failed };
}

/**
 * The pass's `scrape_runs` row, kind DETAIL_REFRESH (WP-09a Q2): what it did,
 * visible next to the listing runs, and never one of them — it claims no
 * complete listing, so §7.6 and Source status pass it by.
 */
function recordPass(
  deps: DetailRefreshDependencies,
  source: SourceRow,
  trigger: ScrapeTrigger,
  startedAt: number,
  requestsMade: number,
  done: { refreshed: number; invalid: number; failed: number },
  failure: RunFailure | undefined,
): void {
  if (deps.runs === undefined) {
    return;
  }
  const run = deps.runs.openRun(source.id, trigger, startedAt, 'DETAIL_REFRESH');
  const worked = done.refreshed + done.invalid > 0;
  deps.runs.closeRun(run.id, nowMs(deps.clock), startedAt, {
    outcome: failure === undefined ? 'SUCCESS' : worked ? 'PARTIAL' : 'FAILED',
    errorKind: failure?.kind ?? null,
    errorDetail: failure?.message ?? null,
    listingComplete: false,
    requestsMade,
    itemsSeen: done.refreshed + done.invalid + done.failed,
    itemsNew: 0,
    itemsUpdated: done.refreshed,
    itemsUnchanged: 0,
    itemsInvalid: done.invalid,
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseConfig(source: SourceRow): unknown {
  try {
    return JSON.parse(source.configJson);
  } catch {
    return {};
  }
}
