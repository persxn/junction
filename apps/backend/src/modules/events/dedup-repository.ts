import type { DedupCandidateStatus, DedupFeatures, Uuid7 } from '@compintel/contracts';
import { and, asc, count, eq, or } from 'drizzle-orm';

import { dedupCandidates, type DedupCandidateRow } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * `dedup_candidates` (§6.2, §7.5). Pairs are stored ordered (`a < b`), so one
 * pair has one row whichever side a scrape found first.
 */
export class DedupCandidatesRepository {
  readonly #db: DatabaseHandle;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, newId: () => Uuid7 = uuid7) {
    this.#db = db;
    this.#newId = newId;
  }

  /** Adds a PENDING pair unless the pair already has a row, whatever its status. */
  insertIfAbsent(
    left: string,
    right: string,
    score: number,
    features: DedupFeatures,
    at: number,
  ): DedupCandidateRow | undefined {
    const [a, b] = left < right ? [left, right] : [right, left];
    if (this.pair(a, b) !== undefined) {
      return undefined;
    }
    const row: DedupCandidateRow = {
      id: this.#newId(),
      eventIdA: a,
      eventIdB: b,
      score,
      featuresJson: JSON.stringify(features),
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    this.#db.drizzle.insert(dedupCandidates).values(row).run();
    return row;
  }

  pair(left: string, right: string): DedupCandidateRow | undefined {
    const [a, b] = left < right ? [left, right] : [right, left];
    return this.#db.drizzle
      .select()
      .from(dedupCandidates)
      .where(and(eq(dedupCandidates.eventIdA, a), eq(dedupCandidates.eventIdB, b)))
      .get();
  }

  get(id: string): DedupCandidateRow | undefined {
    return this.#db.drizzle.select().from(dedupCandidates).where(eq(dedupCandidates.id, id)).get();
  }

  list(status: DedupCandidateStatus, limit: number, offset: number): DedupCandidateRow[] {
    return this.#db.drizzle
      .select()
      .from(dedupCandidates)
      .where(eq(dedupCandidates.status, status))
      .orderBy(asc(dedupCandidates.createdAt), asc(dedupCandidates.id))
      .limit(limit)
      .offset(offset)
      .all();
  }

  count(status: DedupCandidateStatus): number {
    return (
      this.#db.drizzle
        .select({ value: count() })
        .from(dedupCandidates)
        .where(eq(dedupCandidates.status, status))
        .get()?.value ?? 0
    );
  }

  /** Every row naming an event, either side. */
  involving(eventId: string): DedupCandidateRow[] {
    return this.#db.drizzle
      .select()
      .from(dedupCandidates)
      .where(or(eq(dedupCandidates.eventIdA, eventId), eq(dedupCandidates.eventIdB, eventId)))
      .all();
  }

  /** Records a decision and bumps `version` (§6.1). */
  decide(
    row: DedupCandidateRow,
    status: Exclude<DedupCandidateStatus, 'PENDING'>,
    decidedBy: string,
    at: number,
  ): DedupCandidateRow {
    const next = {
      ...row,
      status,
      decidedBy,
      decidedAt: at,
      updatedAt: at,
      version: row.version + 1,
    };
    this.#db.drizzle
      .update(dedupCandidates)
      .set({
        status,
        decidedBy,
        decidedAt: at,
        updatedAt: at,
        version: next.version,
      })
      .where(eq(dedupCandidates.id, row.id))
      .run();
    return next;
  }
}
