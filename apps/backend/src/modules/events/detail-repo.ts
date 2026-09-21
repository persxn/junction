import type { EventCategoryDetail, EventSourceDetail } from '@compintel/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';

import {
  campuses,
  categories,
  eventCategories,
  sourceRecords,
  sources,
} from '../../db/schema/index.js';
import type { Point } from '../../domain/geo/distance.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * What the detail drawer needs that no other repository already answers: the
 * sources with their attribution (D-32), the categories with their origin
 * (D-15) and the campus distances are measured from (D-06).
 *
 * `search/repo.ts` has thinner versions of the first two — the card only needs
 * a key and a name — and they stay where they are: the drawer asking for more
 * is not a reason to make every search row carry it.
 */
export class EventDetailRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** Every source that lists the event, most trusted first, with its attribution. */
  sourcesOf(eventId: string): EventSourceDetail[] {
    return this.#db.drizzle
      .select({
        key: sources.key,
        name: sources.name,
        url: sourceRecords.url,
        firstSeenAt: sourceRecords.firstSeenAt,
        lastSeenAt: sourceRecords.lastSeenAt,
        lastFetchedAt: sourceRecords.lastFetchedAt,
        attributionText: sources.attributionText,
        trustRank: sources.trustRank,
      })
      .from(sourceRecords)
      .innerJoin(sources, eq(sources.id, sourceRecords.sourceId))
      .where(eq(sourceRecords.eventId, eventId))
      .orderBy(desc(sources.trustRank), asc(sources.key))
      .all();
  }

  /**
   * Every category row on the event, suppressions included: the chips have to
   * show a removal as a removal, and the override editor has to know that a
   * suppressed row exists before it clears one (D-15).
   */
  categoriesOf(eventId: string): EventCategoryDetail[] {
    return this.#db.drizzle
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        origin: eventCategories.origin,
        isSuppressed: eventCategories.isSuppressed,
      })
      .from(eventCategories)
      .innerJoin(categories, eq(categories.id, eventCategories.categoryId))
      .where(and(eq(eventCategories.eventId, eventId), eq(categories.isActive, true)))
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .all();
  }

  /** The primary campus, when the wizard has given it coordinates. */
  primaryCampus(): Point | undefined {
    const row = this.#db.drizzle
      .select({ lat: campuses.lat, lon: campuses.lon })
      .from(campuses)
      .where(eq(campuses.isPrimary, true))
      .all()
      .find((candidate) => candidate.lat !== null && candidate.lon !== null);
    return row === undefined ? undefined : { lat: row.lat!, lon: row.lon! };
  }
}
