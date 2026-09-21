import { DEDUP_CANDIDATE_STATUSES, type DedupCandidateStatus } from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { events } from './events.js';
import { users } from './identity.js';

/**
 * Possible duplicates awaiting a person (§6.2 `dedup_candidates`, §7.5, R48 →
 * WP-10).
 *
 * A pair lands here when §7.5's score falls in the grey band: too alike to
 * ignore, not alike enough to merge on the machine's say-so. The two events
 * stay separate until an administrator merges or rejects. The pair is stored
 * with `event_id_a < event_id_b`, so one pair has one row whichever side the
 * scrape found first.
 */
export const dedupCandidates = sqliteTable(
  'dedup_candidates',
  {
    id: text('id').primaryKey(),
    eventIdA: text('event_id_a')
      .notNull()
      .references(() => events.id),
    eventIdB: text('event_id_b')
      .notNull()
      .references(() => events.id),
    score: real('score').notNull(),
    /** `DedupFeatures`, so the review screen can say why. */
    featuresJson: text('features_json').notNull(),
    status: text('status').$type<DedupCandidateStatus>().notNull().default('PENDING'),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: integer('decided_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** §6.1 optimistic concurrency for the review API. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('dedup_candidates_pair_uq').on(table.eventIdA, table.eventIdB),
    index('dedup_candidates_status_idx').on(table.status, table.createdAt),
    index('dedup_candidates_event_id_b_idx').on(table.eventIdB),
    check(
      'dedup_candidates_status_check',
      sql.raw(`"status" in (${DEDUP_CANDIDATE_STATUSES.map((value) => `'${value}'`).join(', ')})`),
    ),
    check('dedup_candidates_order_check', sql.raw(`"event_id_a" < "event_id_b"`)),
    check('dedup_candidates_score_check', sql.raw(`"score" between 0 and 1`)),
    check(
      'dedup_candidates_decided_check',
      sql.raw(`("status" = 'PENDING') = ("decided_at" is null)`),
    ),
    check('dedup_candidates_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type DedupCandidateRow = typeof dedupCandidates.$inferSelect;
