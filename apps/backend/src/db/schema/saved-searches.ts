import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { events } from './events.js';
import { users } from './identity.js';
import { departments } from './organization.js';

/**
 * §6.2 `saved_searches` (+ `version`, `updated_at`) and R112's
 * `saved_search_matches` (WP-24). The matches are a set: "new" is an event id
 * the search has never matched, so an event that leaves and comes back is not
 * new. `last_result_hash` is the SHA-256 of the sorted matching ids, which lets
 * an unchanged run stop before touching the set. Deleting a search takes its
 * matches with it.
 *
 * `department_id` is the owner's department, else the managing one; it is null
 * only on a database no department was ever created in (route tests).
 */
export const savedSearches = sqliteTable(
  'saved_searches',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    departmentId: text('department_id').references(() => departments.id),
    name: text('name').notNull(),
    queryJson: text('query_json').notNull(),
    notifyOnNew: integer('notify_on_new', { mode: 'boolean' }).notNull().default(true),
    lastEvaluatedAt: integer('last_evaluated_at'),
    lastResultHash: text('last_result_hash'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('saved_searches_user_name_uq').on(table.userId, table.name),
    check('saved_searches_version_check', sql`${table.version} >= 1`),
  ],
);
export type SavedSearchRow = typeof savedSearches.$inferSelect;

export const savedSearchMatches = sqliteTable(
  'saved_search_matches',
  {
    savedSearchId: text('saved_search_id')
      .notNull()
      .references(() => savedSearches.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    firstMatchedAt: integer('first_matched_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.savedSearchId, table.eventId] }),
    index('saved_search_matches_event_id_idx').on(table.eventId),
  ],
);
export type SavedSearchMatchRow = typeof savedSearchMatches.$inferSelect;
