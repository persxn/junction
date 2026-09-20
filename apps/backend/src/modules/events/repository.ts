import type { PolicyReason, Uuid7, Visibility } from '@compintel/contracts';
import { and, asc, count, eq, isNull } from 'drizzle-orm';

import { eventDeadlines, eventFieldClaims, events, type EventRow } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * Reading and writing events (§6.2, ruling R57).
 *
 * **`visibleEvents()` is the single sanctioned base query.** Every read path in
 * the product — the feed, search, the calendar, the AI's tools — builds on it,
 * and the reason is R57: an event hidden by policy or lost to a merge is still
 * in the table, so any query that forgets the filter silently shows a professor
 * something the policy said not to. One place to get it right, and one place to
 * change when `MERGED` or a new visibility state arrives.
 */

export interface NewEvent {
  readonly title: string;
  readonly normalizedTitle: string;
  readonly eventType: EventRow['eventType'];
  readonly isRecurringRound: boolean;
  readonly visibility: Visibility;
  readonly policyReason?: PolicyReason | undefined;
  readonly qualityScore: number;
  readonly firstSeenAt: number;
  readonly lastChangedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Everything else §6.2 allows; the caller has already normalized it. */
  readonly fields?: Partial<Omit<EventRow, 'id' | 'version'>>;
}

export interface NewDeadline {
  readonly kind: (typeof eventDeadlines.$inferInsert)['kind'];
  readonly label: string;
  readonly dueAt: number;
  readonly precision: (typeof eventDeadlines.$inferInsert)['precision'];
  readonly sourceRecordId?: string | undefined;
}

export interface NewClaim {
  readonly field: (typeof eventFieldClaims.$inferInsert)['field'];
  readonly valueJson: string | null;
  readonly sourceRecordId: string;
  readonly observedAt: number;
  readonly isSelected: boolean;
}

export interface EventsRepositoryOptions {
  readonly newId?: () => Uuid7;
}

export class EventsRepository {
  readonly #db: DatabaseHandle;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, options: EventsRepositoryOptions = {}) {
    this.#db = db;
    this.#newId = options.newId ?? uuid7;
  }

  /**
   * Inserts an event with its deadlines and its provenance claims.
   *
   * Not transactional on its own — the caller wraps it, because the audit row
   * belongs in the same transaction (R35) and only the caller knows what the
   * change was for.
   */
  insert(
    event: NewEvent,
    deadlines: readonly NewDeadline[] = [],
    claims: readonly NewClaim[] = [],
  ): string {
    const id = this.#newId();
    this.#db.drizzle
      .insert(events)
      .values({
        ...event.fields,
        id,
        title: event.title,
        normalizedTitle: event.normalizedTitle,
        eventType: event.eventType,
        isRecurringRound: event.isRecurringRound,
        visibility: event.visibility,
        policyReason: event.policyReason ?? null,
        qualityScore: event.qualityScore,
        firstSeenAt: event.firstSeenAt,
        lastChangedAt: event.lastChangedAt,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      })
      .run();

    for (const deadline of deadlines) {
      this.#db.drizzle
        .insert(eventDeadlines)
        .values({
          id: this.#newId(),
          eventId: id,
          kind: deadline.kind,
          label: deadline.label,
          dueAt: deadline.dueAt,
          precision: deadline.precision,
          origin: 'SOURCE',
          sourceRecordId: deadline.sourceRecordId ?? null,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
        })
        .run();
    }

    for (const claim of claims) {
      this.#db.drizzle
        .insert(eventFieldClaims)
        .values({
          id: this.#newId(),
          eventId: id,
          field: claim.field,
          valueJson: claim.valueJson,
          sourceRecordId: claim.sourceRecordId,
          observedAt: claim.observedAt,
          isSelected: claim.isSelected,
        })
        .run();
    }

    return id;
  }

  /**
   * The one condition every read path shares (R57): visible, and not the losing
   * side of a merge.
   */
  static visibleCondition(): ReturnType<typeof and> {
    return and(eq(events.visibility, 'VISIBLE'), isNull(events.mergedIntoEventId));
  }

  /** Every event a professor may see. The base of every later query. */
  visibleEvents(): EventRow[] {
    return this.#db.drizzle.select().from(events).where(EventsRepository.visibleCondition()).all();
  }

  listVisibleEvents(limit = 50, offset = 0): EventRow[] {
    return (
      this.#db.drizzle
        .select()
        .from(events)
        .where(EventsRepository.visibleCondition())
        // Soonest deadline first is the order a professor wants; §8.4's real
        // ranking arrives with WP-15b.
        .orderBy(asc(events.registrationDeadlineAt), asc(events.startsAt), asc(events.id))
        .limit(limit)
        .offset(offset)
        .all()
    );
  }

  getVisibleEventById(id: string): EventRow | undefined {
    return this.#db.drizzle
      .select()
      .from(events)
      .where(and(eq(events.id, id), EventsRepository.visibleCondition()))
      .get();
  }

  countVisibleEvents(): number {
    return (
      this.#db.drizzle
        .select({ value: count() })
        .from(events)
        .where(EventsRepository.visibleCondition())
        .get()?.value ?? 0
    );
  }

  /** Every event, visible or not — for the policy re-evaluation and the tests. */
  allEvents(): EventRow[] {
    return this.#db.drizzle.select().from(events).all();
  }

  /**
   * Applies a fresh policy verdict to a stored row (R57).
   *
   * This is what makes "no re-scrape" true: widening a policy walks the stored
   * events and updates two columns. The event's own data is untouched.
   */
  setVisibility(
    id: string,
    visibility: Visibility,
    reason: PolicyReason | undefined,
    at: number,
  ): void {
    this.#db.drizzle
      .update(events)
      .set({ visibility, policyReason: reason ?? null, updatedAt: at })
      .where(eq(events.id, id))
      .run();
  }

  deadlinesOf(eventId: string): (typeof eventDeadlines.$inferSelect)[] {
    return this.#db.drizzle
      .select()
      .from(eventDeadlines)
      .where(eq(eventDeadlines.eventId, eventId))
      .orderBy(asc(eventDeadlines.dueAt))
      .all();
  }

  claimsOf(eventId: string): (typeof eventFieldClaims.$inferSelect)[] {
    return this.#db.drizzle
      .select()
      .from(eventFieldClaims)
      .where(eq(eventFieldClaims.eventId, eventId))
      .all();
  }
}
