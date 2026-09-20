import { EventCandidate, type ParseWarning } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { SourceRow } from '../db/schema/index.js';
import {
  payloadHash,
  type SourceRecordsRepository,
  type UpsertOutcome,
} from '../modules/sources/records.js';
import type {
  AdapterContext,
  ListingItem,
  NormalizeContext,
  SourceAdapter,
} from '../sources/types.js';
import type { SnapshotStore } from './snapshots.js';

/**
 * One listing item, from raw payload to a `source_records` row (§7's pipeline).
 *
 * The rule that shapes this file is "**one bad item never fails a run**". An
 * item that will not normalize, or normalizes into something `EventCandidate`
 * rejects, is counted in `items_invalid` with its complaints kept as warnings —
 * and **no row is written**, so every row in `source_records` is a candidate the
 * rest of the pipeline can trust without re-validating.
 *
 * That last part is R50 doing real work. `EventCandidate` is `.strict()`, so an
 * adapter that leaks a `participants` array makes validation *fail* rather than
 * quietly dropping the field: the item is invalid, loudly, in a counter an admin
 * can see.
 */

export interface ProcessItemOptions {
  readonly source: SourceRow;
  readonly adapter: SourceAdapter;
  readonly context: AdapterContext;
  readonly normalizeContext: NormalizeContext;
  readonly records: SourceRecordsRepository;
  readonly snapshots: SnapshotStore | undefined;
  readonly logger: Logger;
  readonly at: number;
  /**
   * Whether a detail fetch is still owed, asked once the listing hash is known:
   * `changed` is true when the payload moved. A `true` answer leaves
   * `last_fetched_at` behind `last_seen_at`, which is what `detail-refresh`
   * looks for (§7.2: "the remainder continues next run").
   */
  readonly detailPending: (changed: boolean) => boolean;
}

export interface ProcessedItem {
  readonly outcome: UpsertOutcome | 'INVALID';
  readonly recordId: string | undefined;
  /** True when the listing hash moved, i.e. a detail fetch is worth making. */
  readonly changed: boolean;
}

/**
 * Normalizes, validates, snapshots and upserts one item.
 *
 * The snapshot is written **before** the upsert and its reference goes into the
 * row, so a row can never point at a file that was not written. The reverse
 * order would leave a dangling reference every time the process died in between.
 */
export function processItem(
  item: ListingItem,
  options: ProcessItemOptions,
  payload: unknown = item.payload,
): ProcessedItem {
  const { source, adapter, logger } = options;

  let candidate: unknown;
  try {
    candidate = adapter.normalize(
      payload === item.payload ? item : { item, payload },
      options.normalizeContext,
    );
  } catch (error) {
    logger.warn(
      { source: source.key, externalKey: item.externalKey, err: error },
      'an item could not be normalized and was counted as invalid',
    );
    return { outcome: 'INVALID', recordId: undefined, changed: false };
  }

  const parsed = EventCandidate.safeParse(candidate);
  if (!parsed.success) {
    logger.warn(
      {
        source: source.key,
        externalKey: item.externalKey,
        issues: parsed.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      'an item did not validate as an EventCandidate and was counted as invalid',
    );
    return { outcome: 'INVALID', recordId: undefined, changed: false };
  }

  const warnings: readonly ParseWarning[] = parsed.data.warnings;
  const hash = payloadHash(parsed.data);
  const existing = options.records.find(source.id, item.externalKey);
  const changed = existing?.contentHash !== hash;

  // Only snapshot what changed: §7.8 exists to explain breakage, and fifteen
  // identical copies of an unchanged listing explain nothing.
  const raw = item.raw;
  const snapshotRef =
    changed && raw !== undefined
      ? options.snapshots?.write(source.key, existing?.id ?? item.externalKey, raw)
      : undefined;

  const result = options.records.upsert({
    sourceId: source.id,
    externalKey: item.externalKey,
    url: item.url,
    contentHash: hash,
    payloadJson: JSON.stringify(parsed.data),
    parseWarnings: warnings,
    rawSnapshotRef: snapshotRef,
    detailPending: options.detailPending(changed),
    at: options.at,
  });
  return { outcome: result.outcome, recordId: result.record.id, changed };
}
