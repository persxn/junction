import {
  OUTCOME_RESULTS,
  OUTCOME_TEXT_MAX,
  PRIZE_TEXT_MAX,
  type OutcomeResult,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { engagements } from './engagements.js';
import { users } from './identity.js';
import { resources } from './resources.js';

/**
 * §6.2 `engagement_outcomes` (Q7 resolved, D-21, ruling R104, roadmap WP-21):
 * one per competition, keyed by it. A prize amount and its currency come
 * together or not at all and are never converted (R63). The certificate is a
 * `resources` row; removing it leaves the outcome without one.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const engagementOutcomes = sqliteTable(
  'engagement_outcomes',
  {
    engagementId: text('engagement_id')
      .primaryKey()
      .references(() => engagements.id),
    result: text('result').$type<OutcomeResult>().notNull(),
    rank: integer('rank'),
    prizeText: text('prize_text'),
    prizeMinor: integer('prize_minor'),
    prizeCurrency: text('prize_currency'),
    certificateResourceId: text('certificate_resource_id').references(() => resources.id, {
      onDelete: 'set null',
    }),
    resultUrl: text('result_url'),
    notes: text('notes'),
    feedback: text('feedback'),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.id),
    recordedAt: integer('recorded_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  () => [
    check('engagement_outcomes_result_check', sql.raw(inList('result', OUTCOME_RESULTS))),
    check('engagement_outcomes_rank_check', sql.raw(`"rank" is null or "rank" >= 1`)),
    // R63: an amount and its currency together, or neither; ISO 4217 upper case. The
    // `is not null` terms matter: a CHECK that comes out NULL passes.
    check(
      'engagement_outcomes_prize_check',
      sql.raw(
        `("prize_minor" is null and "prize_currency" is null) or ("prize_minor" is not null and "prize_currency" is not null and "prize_minor" >= 0 and "prize_currency" glob '[A-Z][A-Z][A-Z]')`,
      ),
    ),
    check(
      'engagement_outcomes_prize_text_check',
      sql.raw(`"prize_text" is null or length("prize_text") <= ${String(PRIZE_TEXT_MAX)}`),
    ),
    check(
      'engagement_outcomes_result_url_check',
      sql.raw(
        `"result_url" is null or "result_url" like 'http://%' or "result_url" like 'https://%'`,
      ),
    ),
    check(
      'engagement_outcomes_text_check',
      sql.raw(
        `("notes" is null or length("notes") <= ${String(OUTCOME_TEXT_MAX)}) and ("feedback" is null or length("feedback") <= ${String(OUTCOME_TEXT_MAX)})`,
      ),
    ),
    check('engagement_outcomes_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type EngagementOutcomeRow = typeof engagementOutcomes.$inferSelect;
