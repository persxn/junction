import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { events } from './events.js';
import { users } from './identity.js';

/**
 * Search support tables (§6.2 "Taxonomy" and "Events", §8.2, WP-15a).
 *
 * The FTS5 indexes themselves (`event_fts`, `event_fts_trigram`) and the
 * triggers that feed them are **not** here: Drizzle cannot model a virtual
 * table or a trigger (F6), so they live in the custom SQL migration 0014.
 */

/** Where a vocabulary term was seen; a term found in several places keeps the first kind here. */
export const VOCABULARY_KINDS = ['TITLE', 'ORGANIZER', 'TAG', 'CATEGORY', 'ALIAS'] as const;
export type VocabularyKind = (typeof VOCABULARY_KINDS)[number];

/**
 * The typo-tolerance vocabulary (F5/A5): distinct tokens a correction may land
 * on, with how many visible events carry each one. Rebuilt wholesale after an
 * ingest, so it holds no history and nothing refers to it.
 */
export const searchVocabulary = sqliteTable(
  'search_vocabulary',
  {
    term: text('term').primaryKey(),
    kind: text('kind').$type<VocabularyKind>().notNull(),
    docFreq: integer('doc_freq').notNull(),
  },
  () => [
    check(
      'search_vocabulary_kind_check',
      sql.raw(`"kind" in (${VOCABULARY_KINDS.map((kind) => `'${kind}'`).join(', ')})`),
    ),
    check('search_vocabulary_doc_freq_check', sql.raw(`"doc_freq" >= 0`)),
  ],
);
export type SearchVocabularyRow = typeof searchVocabulary.$inferSelect;

/** Admin-editable synonyms (§6.2): `ml` → `["machine learning"]`. */
export const searchAliases = sqliteTable('search_aliases', {
  term: text('term').primaryKey(),
  expansionsJson: text('expansions_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').references(() => users.id),
});
export type SearchAliasRow = typeof searchAliases.$inferSelect;

/**
 * Per-user hide state (§6.2). The query builder's `excludeHidden` reads it;
 * WP-16a's hide/unhide routes write it.
 */
export const eventUserState = sqliteTable(
  'event_user_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
    hiddenReason: text('hidden_reason'),
    seenAt: integer('seen_at'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.eventId] }),
    index('event_user_state_event_id_idx').on(table.eventId),
  ],
);
export type EventUserStateRow = typeof eventUserState.$inferSelect;

/** A professor's saved events (§6.2). `watchlistedOnly` reads it; WP-16a writes it. */
export const watchlistItems = sqliteTable(
  'watchlist_items',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    note: text('note'),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.eventId] }),
    index('watchlist_items_event_id_idx').on(table.eventId),
  ],
);
export type WatchlistItemRow = typeof watchlistItems.$inferSelect;
