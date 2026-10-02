import type { ScrapeTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { SourceRow } from '../db/schema/index.js';
import type { SourceRecordsRepository } from '../modules/sources/records.js';
import { APP_TIMEZONE, nowMs, type Clock } from '../platform/time.js';
import type { AdapterContext, ListingItem, SourceAdapter } from '../sources/types.js';
import { toRunFailure } from './errors.js';
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
 * It deliberately writes **no `scrape_runs` row** and touches **no
 * `source_state`**. Those describe listing runs: §7.6 counts them to decide what
 * has gone missing, and Source status reads them to say how fresh a source is. A
 * detail pass answers neither question, and rows that look like listing runs but
 * are not would corrupt both. Its own health is the `detail-refresh` row in
 * `job_state`.
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
  if (adapter.detail === undefined) {
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
      const detail = await adapter.detail(context, item);
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
      deps.logger.warn(
        { source: source.key, externalKey: record.externalKey, kind: toRunFailure(error).kind },
        'a detail fetch failed and will be retried next pass',
      );
      break;
    }
  }
  return { attempted: owed.length, refreshed, invalid, failed };
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
