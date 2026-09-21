import { createHash } from 'node:crypto';

import { and, asc, eq, lt, sql } from 'drizzle-orm';

import { sourceRecords, type SourceRecordRow } from '../../db/schema/index.js';
import { canonicalJson } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * `source_records` — what one source says about one event (§6.2, §7.6).
 *
 * Every write here happens in its own transaction, because §7's pipeline says
 * so and because the alternative is a run that fails halfway and leaves the
 * first eighty items applied and the rest not. One bad item never fails a run,
 * and one item never half-lands.
 */

/** §7.6: three consecutive complete runs without a mention. */
export const MISSING_AFTER_COMPLETE_RUNS = 3;

/**
 * The content hash a changed-detection is based on.
 *
 * It is the *canonical* JSON of the payload — sorted keys, no whitespace — so a
 * source that re-serializes its own response in a different key order does not
 * look like a change. That is not hypothetical: a JSON API behind a load
 * balancer can and does.
 */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export interface RecordUpsert {
  readonly sourceId: string;
  readonly externalKey: string;
  readonly url: string;
  readonly contentHash: string;
  /** A validated `EventCandidate`, already serialized. */
  readonly payloadJson: string;
  readonly parseWarnings: readonly unknown[];
  readonly rawSnapshotRef?: string | undefined;
  /**
   * True when this item's detail fetch is still owed — the listing hash moved
   * and the run's detail cap was reached. It leaves `last_fetched_at` behind
   * `last_seen_at`, which is exactly what `detail-refresh` looks for.
   */
  readonly detailPending: boolean;
  readonly at: number;
}

export type UpsertOutcome = 'NEW' | 'UPDATED' | 'UNCHANGED';

export interface UpsertResult {
  readonly outcome: UpsertOutcome;
  readonly record: SourceRecordRow;
}

export class SourceRecordsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /**
   * Runs `work` in one transaction (a SAVEPOINT inside an open one). The scrape
   * item uses it so the record upsert and WP-10's event link commit together.
   */
  transaction<T>(work: () => T): T {
    return this.#db.raw.transaction(work).immediate();
  }

  find(sourceId: string, externalKey: string): SourceRecordRow | undefined {
    return this.#db.drizzle
      .select()
      .from(sourceRecords)
      .where(and(eq(sourceRecords.sourceId, sourceId), eq(sourceRecords.externalKey, externalKey)))
      .get();
  }

  list(sourceId: string): readonly SourceRecordRow[] {
    return this.#db.drizzle
      .select()
      .from(sourceRecords)
      .where(eq(sourceRecords.sourceId, sourceId))
      .orderBy(asc(sourceRecords.externalKey))
      .all();
  }

  /**
   * Inserts or updates one record, in one transaction.
   *
   * Seeing a record always clears `MISSING`: a source that has listed it again
   * has answered the only question §7.6 was asking. The event link and the match
   * method are never touched — they are WP-10's, and a re-scrape must not undo a
   * person's merge decision.
   */
  upsert(input: RecordUpsert): UpsertResult {
    return this.#db.raw
      .transaction((): UpsertResult => {
        const existing = this.find(input.sourceId, input.externalKey);
        const parseWarningsJson = JSON.stringify(input.parseWarnings);
        if (existing === undefined) {
          const row: SourceRecordRow = {
            id: uuid7(),
            sourceId: input.sourceId,
            externalKey: input.externalKey,
            url: input.url,
            firstSeenAt: input.at,
            lastSeenAt: input.at,
            lastFetchedAt: input.detailPending ? 0 : input.at,
            contentHash: input.contentHash,
            payloadJson: input.payloadJson,
            rawSnapshotRef: input.rawSnapshotRef ?? null,
            parseWarningsJson,
            presence: 'LISTED',
            missingSince: null,
            eventId: null,
            matchMethod: 'NEW',
            matchScore: null,
            originEventId: null,
          };
          this.#db.drizzle.insert(sourceRecords).values(row).run();
          return { outcome: 'NEW', record: row };
        }

        const changed = existing.contentHash !== input.contentHash;
        const patch = {
          url: input.url,
          lastSeenAt: input.at,
          lastFetchedAt: input.detailPending ? existing.lastFetchedAt : input.at,
          contentHash: input.contentHash,
          payloadJson: input.payloadJson,
          parseWarningsJson,
          rawSnapshotRef: input.rawSnapshotRef ?? existing.rawSnapshotRef,
          presence: 'LISTED' as const,
          missingSince: null,
        };
        this.#db.drizzle
          .update(sourceRecords)
          .set(patch)
          .where(eq(sourceRecords.id, existing.id))
          .run();
        return {
          outcome: changed ? 'UPDATED' : 'UNCHANGED',
          record: { ...existing, ...patch },
        };
      })
      .immediate();
  }

  /**
   * A 304, or a listing item whose hash did not move: nothing to write but the
   * fact that the source still lists it.
   */
  touch(recordId: string, at: number): void {
    this.#db.drizzle
      .update(sourceRecords)
      .set({ lastSeenAt: at, lastFetchedAt: at, presence: 'LISTED', missingSince: null })
      .where(eq(sourceRecords.id, recordId))
      .run();
  }

  /**
   * "The listing is byte-for-byte what it was last time" — a 304.
   *
   * Every record the source still lists is marked seen, which is exactly what
   * the unchanged response asserts. Records already `MISSING` stay missing: the
   * listing that has not changed is the same one that did not mention them.
   */
  touchAll(sourceId: string, at: number): number {
    return this.#db.drizzle
      .update(sourceRecords)
      .set({ lastSeenAt: at, lastFetchedAt: at })
      .where(and(eq(sourceRecords.sourceId, sourceId), eq(sourceRecords.presence, 'LISTED')))
      .run().changes;
  }

  /**
   * §7.6, as one statement.
   *
   * A record goes MISSING when three *complete* listing runs have started since
   * it was last seen. The count is a correlated subquery over `scrape_runs`
   * rather than a counter column, which means a PARTIAL run is excluded by
   * construction — it has `listing_complete = 0` and is simply not counted —
   * rather than by a rule somewhere else that has to stay in step.
   *
   * `missing_since` is set once and never moved, so the UI's "not seen at source
   * since <date>" keeps saying when it actually happened. Nothing is ever
   * auto-cancelled: that is a claim about the event, and only a source or a
   * person may make it.
   */
  markMissing(sourceId: string, at: number): number {
    const statement = this.#db.raw.prepare(`
      update source_records
         set presence = 'MISSING',
             missing_since = coalesce(missing_since, @at)
       where source_id = @sourceId
         and presence = 'LISTED'
         and (
           select count(*) from scrape_runs r
            where r.source_id = source_records.source_id
              and r.listing_complete = 1
              and r.started_at > source_records.last_seen_at
         ) >= @threshold
    `);
    return statement.run({ sourceId, at, threshold: MISSING_AFTER_COMPLETE_RUNS }).changes;
  }

  /**
   * Records whose detail fetch is still owed, oldest first. This is the whole of
   * the `detail-refresh` job's query: `last_fetched_at < last_seen_at` means
   * "the listing mentioned it after the last time we read it properly".
   */
  awaitingDetail(sourceId: string, limit: number): readonly SourceRecordRow[] {
    return this.#db.drizzle
      .select()
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.sourceId, sourceId),
          eq(sourceRecords.presence, 'LISTED'),
          lt(sourceRecords.lastFetchedAt, sourceRecords.lastSeenAt),
        ),
      )
      .orderBy(asc(sourceRecords.lastFetchedAt))
      .limit(limit)
      .all();
  }

  /** How many records a source holds, by presence. Source status shows it. */
  countByPresence(sourceId: string): Readonly<Record<string, number>> {
    const rows = this.#db.drizzle
      .select({ presence: sourceRecords.presence, total: sql<number>`count(*)` })
      .from(sourceRecords)
      .where(eq(sourceRecords.sourceId, sourceId))
      .groupBy(sourceRecords.presence)
      .all();
    return Object.fromEntries(rows.map((row) => [row.presence, row.total]));
  }
}
