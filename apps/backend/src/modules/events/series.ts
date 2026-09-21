import type { CandidateSeries, Recurrence, Uuid7 } from '@compintel/contracts';
import { eq } from 'drizzle-orm';

import { eventSeries, events, type EventSeriesRow } from '../../db/schema/index.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * `event_series` and `events.series_id` (§6.2, §7.3 "Recurring rounds", WP-11).
 *
 * A series is upserted by its normalized key, and an event is pointed at it
 * inside the scrape item's transaction. Both writes are audited as SCHEDULER
 * (R35) — the machine grouped these rows, and "why is this in the Contest
 * Calendar?" deserves an answer with a date on it.
 */

/** A concrete cadence is better evidence than IRREGULAR; IRREGULAR never overwrites one. */
const SPECIFIC: ReadonlySet<Recurrence> = new Set(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY']);

export class SeriesRepository {
  readonly #db: DatabaseHandle;
  readonly #audit: AuditLog;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, audit: AuditLog, newId: () => Uuid7 = uuid7) {
    this.#db = db;
    this.#audit = audit;
    this.#newId = newId;
  }

  byKey(key: string): EventSeriesRow | undefined {
    return this.#db.drizzle.select().from(eventSeries).where(eq(eventSeries.seriesKey, key)).get();
  }

  byId(id: string): EventSeriesRow | undefined {
    return this.#db.drizzle.select().from(eventSeries).where(eq(eventSeries.id, id)).get();
  }

  all(): EventSeriesRow[] {
    return this.#db.drizzle.select().from(eventSeries).all();
  }

  /** Upserts the series and points the event at it. Returns the series id. */
  assign(
    eventId: string,
    series: CandidateSeries,
    organizerName: string | null,
    at: number,
  ): string {
    let row = this.byKey(series.key);
    if (row === undefined) {
      const created: EventSeriesRow = {
        id: this.#newId(),
        name: series.name,
        seriesKey: series.key,
        organizerName,
        recurrence: series.recurrence,
        isRatedContest: series.isRecurringRound,
        createdAt: at,
        updatedAt: at,
      };
      withAudit(
        this.#audit,
        {
          actorKind: 'SCHEDULER',
          actorUserId: null,
          action: 'event_series.created',
          entityKind: 'event_series',
          entityId: created.id,
          summary: `Detected the series "${series.name}" (${series.recurrence})`,
          diff: { key: series.key, recurrence: series.recurrence, rated: series.isRecurringRound },
        },
        () => {
          this.#db.drizzle.insert(eventSeries).values(created).run();
        },
      );
      row = created;
    } else if (
      row.recurrence !== series.recurrence &&
      SPECIFIC.has(series.recurrence) &&
      !SPECIFIC.has(row.recurrence)
    ) {
      this.#db.drizzle
        .update(eventSeries)
        .set({ recurrence: series.recurrence, updatedAt: at })
        .where(eq(eventSeries.id, row.id))
        .run();
    }

    const current = this.#db.drizzle
      .select({ seriesId: events.seriesId })
      .from(events)
      .where(eq(events.id, eventId))
      .get();
    if (current !== undefined && current.seriesId !== row.id) {
      const seriesId = row.id;
      withAudit(
        this.#audit,
        {
          actorKind: 'SCHEDULER',
          actorUserId: null,
          action: 'event.series.assigned',
          entityKind: 'event',
          entityId: eventId,
          summary: `Grouped into "${row.name}"${series.roundLabel === undefined ? '' : ` as round ${series.roundLabel}`}`,
          diff: { seriesId, previous: current.seriesId, round: series.isRecurringRound },
        },
        () => {
          this.#db.drizzle.update(events).set({ seriesId }).where(eq(events.id, eventId)).run();
        },
      );
    }
    return row.id;
  }
}
