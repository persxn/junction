import type { ChangeCause, MatchMethod, OverrideField, Uuid7 } from '@compintel/contracts';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';

import type { AlternateClaimValue } from '../../domain/events/claims.js';
import type { ResolvableClaim, ResolvableOverride } from '../../domain/events/resolve.js';
import {
  eventChanges,
  eventDeadlines,
  eventFieldClaims,
  eventOverrides,
  sourceRecords,
  sources,
  type EventChangeRow,
  type SourceRecordRow,
} from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import type { NewDeadline } from './repository.js';

/**
 * Claims, overrides, changes, deadlines and record links (§6.2, WP-10).
 *
 * Nothing here opens a transaction: every caller is already inside one — the
 * scrape item's, or a merge's `withAudit` — and these writes only mean
 * something together with the ones around them.
 */

export interface NewChange {
  readonly eventId: string;
  readonly field: OverrideField;
  readonly oldValueJson: string | null;
  readonly newValueJson: string | null;
  readonly cause: ChangeCause;
  readonly sourceRecordId?: string | null | undefined;
  readonly changedBy?: string | null | undefined;
  readonly at: number;
}

export class ProvenanceRepository {
  readonly #db: DatabaseHandle;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, newId: () => Uuid7 = uuid7) {
    this.#db = db;
    this.#newId = newId;
  }

  /** Every claim on an event, with the source that made it and its trust rank. */
  claimsOf(eventId: string): ResolvableClaim[] {
    return this.#db.drizzle
      .select({
        id: eventFieldClaims.id,
        field: eventFieldClaims.field,
        valueJson: eventFieldClaims.valueJson,
        sourceRecordId: eventFieldClaims.sourceRecordId,
        observedAt: eventFieldClaims.observedAt,
        isAlternate: eventFieldClaims.isAlternate,
        note: eventFieldClaims.note,
        sourceKey: sources.key,
        trustRank: sources.trustRank,
      })
      .from(eventFieldClaims)
      .innerJoin(sourceRecords, eq(sourceRecords.id, eventFieldClaims.sourceRecordId))
      .innerJoin(sources, eq(sources.id, sourceRecords.sourceId))
      .where(eq(eventFieldClaims.eventId, eventId))
      .all();
  }

  overridesOf(eventId: string): ResolvableOverride[] {
    return this.#db.drizzle
      .select({
        field: eventOverrides.field,
        valueJson: eventOverrides.valueJson,
        clearedAt: eventOverrides.clearedAt,
      })
      .from(eventOverrides)
      .where(eq(eventOverrides.eventId, eventId))
      .all();
  }

  /**
   * Writes one record's claims onto its event: one row per field, updated in
   * place on a re-scrape, plus at most one R63 alternate per field. An
   * alternate the source no longer states is emptied rather than removed, so
   * its history is not lost with it.
   */
  upsertClaims(
    eventId: string,
    recordId: string,
    values: Readonly<Record<string, string | null>>,
    alternates: readonly AlternateClaimValue[],
    at: number,
  ): void {
    const existing = this.#db.drizzle
      .select()
      .from(eventFieldClaims)
      .where(eq(eventFieldClaims.sourceRecordId, recordId))
      .all();
    const key = (field: string, alternate: boolean): string => `${field}|${String(alternate)}`;
    const byKey = new Map(existing.map((row) => [key(row.field, row.isAlternate), row]));

    const write = (
      field: OverrideField,
      valueJson: string | null,
      alternate: boolean,
      note: string | null,
    ): void => {
      const row = byKey.get(key(field, alternate));
      if (row === undefined) {
        this.#db.drizzle
          .insert(eventFieldClaims)
          .values({
            id: this.#newId(),
            eventId,
            field,
            valueJson,
            sourceRecordId: recordId,
            observedAt: at,
            isSelected: false,
            isAlternate: alternate,
            note,
          })
          .run();
        return;
      }
      this.#db.drizzle
        .update(eventFieldClaims)
        .set({ eventId, valueJson, observedAt: at, note })
        .where(eq(eventFieldClaims.id, row.id))
        .run();
    };

    for (const [field, valueJson] of Object.entries(values)) {
      write(field as OverrideField, valueJson, false, null);
    }
    const stated = new Set(alternates.map((alternate) => alternate.field));
    for (const alternate of alternates) {
      write(alternate.field, alternate.valueJson, true, alternate.note);
    }
    for (const row of existing) {
      if (row.isAlternate && !stated.has(row.field) && row.valueJson !== null) {
        write(row.field, null, true, row.note);
      }
    }
  }

  /** Marks exactly `selected` as the claims reflected on the event. */
  setSelected(eventId: string, selected: ReadonlySet<string>): void {
    this.#db.drizzle
      .update(eventFieldClaims)
      .set({ isSelected: false })
      .where(eq(eventFieldClaims.eventId, eventId))
      .run();
    const ids = [...selected];
    for (let index = 0; index < ids.length; index += 400) {
      this.#db.drizzle
        .update(eventFieldClaims)
        .set({ isSelected: true })
        .where(inArray(eventFieldClaims.id, ids.slice(index, index + 400)))
        .run();
    }
  }

  insertChange(change: NewChange): void {
    this.#db.drizzle
      .insert(eventChanges)
      .values({
        id: this.#newId(),
        eventId: change.eventId,
        field: change.field,
        oldValueJson: change.oldValueJson,
        newValueJson: change.newValueJson,
        cause: change.cause,
        sourceRecordId: change.sourceRecordId ?? null,
        changedBy: change.changedBy ?? null,
        detectedAt: change.at,
      })
      .run();
  }

  /** Newest first; `before` is the last id of the previous page (UUIDv7 sorts by time). */
  changesOf(eventId: string, limit: number, before?: string): EventChangeRow[] {
    return this.#db.drizzle
      .select()
      .from(eventChanges)
      .where(
        before === undefined
          ? eq(eventChanges.eventId, eventId)
          : and(eq(eventChanges.eventId, eventId), lt(eventChanges.id, before)),
      )
      .orderBy(desc(eventChanges.id))
      .limit(limit)
      .all();
  }

  /** The most recent MERGE change of one field, which records what an unmerge restores. */
  lastMergeChange(eventId: string, field: OverrideField): EventChangeRow | undefined {
    return this.#db.drizzle
      .select()
      .from(eventChanges)
      .where(
        and(
          eq(eventChanges.eventId, eventId),
          eq(eventChanges.field, field),
          eq(eventChanges.cause, 'MERGE'),
        ),
      )
      .orderBy(desc(eventChanges.id))
      .limit(1)
      .get();
  }

  /**
   * One record's deadlines on its event: matched by kind and label and updated
   * in place, otherwise added. A deadline a source stops listing is left as it
   * was — it may still be true, and deleting it would lose the history.
   */
  syncDeadlines(
    eventId: string,
    recordId: string,
    deadlines: readonly NewDeadline[],
    at: number,
  ): void {
    const existing = this.#db.drizzle
      .select()
      .from(eventDeadlines)
      .where(eq(eventDeadlines.sourceRecordId, recordId))
      .all();
    for (const deadline of deadlines) {
      const row = existing.find(
        (candidate) => candidate.kind === deadline.kind && candidate.label === deadline.label,
      );
      if (row === undefined) {
        this.#db.drizzle
          .insert(eventDeadlines)
          .values({
            id: this.#newId(),
            eventId,
            kind: deadline.kind,
            label: deadline.label,
            dueAt: deadline.dueAt,
            precision: deadline.precision,
            origin: 'SOURCE',
            sourceRecordId: recordId,
            createdAt: at,
            updatedAt: at,
          })
          .run();
      } else if (row.dueAt !== deadline.dueAt || row.precision !== deadline.precision) {
        this.#db.drizzle
          .update(eventDeadlines)
          .set({ eventId, dueAt: deadline.dueAt, precision: deadline.precision, updatedAt: at })
          .where(eq(eventDeadlines.id, row.id))
          .run();
      }
    }
  }

  // ---- source_records links (WP-09a leaves these to WP-10) ------------------

  /** First link of a record: its event, how it matched, and its origin (R66). */
  linkRecord(recordId: string, eventId: string, method: MatchMethod, score: number | null): void {
    this.#db.drizzle
      .update(sourceRecords)
      .set({ eventId, originEventId: eventId, matchMethod: method, matchScore: score })
      .where(eq(sourceRecords.id, recordId))
      .run();
  }

  recordsOf(eventId: string): SourceRecordRow[] {
    return this.#db.drizzle
      .select()
      .from(sourceRecords)
      .where(eq(sourceRecords.eventId, eventId))
      .all();
  }

  /**
   * Moves records — and the claims and source deadlines that belong to them —
   * to another event. Used by merge and unmerge alike; nothing is copied and
   * nothing is removed, which is what makes the two exact inverses.
   */
  moveRecords(recordIds: readonly string[], toEventId: string): void {
    for (let index = 0; index < recordIds.length; index += 400) {
      const slice = [...recordIds.slice(index, index + 400)];
      this.#db.drizzle
        .update(sourceRecords)
        .set({ eventId: toEventId })
        .where(inArray(sourceRecords.id, slice))
        .run();
      this.#db.drizzle
        .update(eventFieldClaims)
        .set({ eventId: toEventId })
        .where(inArray(eventFieldClaims.sourceRecordId, slice))
        .run();
      this.#db.drizzle
        .update(eventDeadlines)
        .set({ eventId: toEventId })
        .where(inArray(eventDeadlines.sourceRecordId, slice))
        .run();
    }
  }

  /** Records currently on `holderId` that were first linked to one of `origins`. */
  recordsFrom(holderId: string, origins: readonly string[]): SourceRecordRow[] {
    if (origins.length === 0) {
      return [];
    }
    return this.#db.drizzle
      .select()
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.eventId, holderId),
          inArray(sourceRecords.originEventId, [...origins]),
        ),
      )
      .all();
  }

  /** `source.key` for each record on an event, for the review screen. */
  sourceKeysOf(eventId: string): string[] {
    const rows = this.#db.drizzle
      .selectDistinct({ key: sources.key })
      .from(sourceRecords)
      .innerJoin(sources, eq(sources.id, sourceRecords.sourceId))
      .where(eq(sourceRecords.eventId, eventId))
      .all();
    return rows.map((row) => row.key).sort();
  }
}
