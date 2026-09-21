import {
  CATEGORY_ORIGINS,
  CATEGORY_RULE_FIELDS,
  CATEGORY_RULE_KINDS,
  type CategoryOrigin,
  type CategoryRuleField,
  type CategoryRuleKind,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { events } from './events.js';
import { users } from './identity.js';

/**
 * Taxonomy (§6.2 "Taxonomy", "Events" `event_categories`/`event_tags`,
 * "Identity" `user_interest_tags`; R48 gives the joins to WP-15b; D-15).
 *
 * Categories come from source tags and deterministic rules; a professor's
 * MANUAL row beats both and survives every re-classification. A removal is a
 * row too (`is_suppressed = 1`), so a rule cannot quietly put back what a
 * person took away.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const TAG_KINDS = ['SKILL', 'TECHNOLOGY', 'THEME', 'INTEREST'] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => categories.id),
    description: text('description'),
    colorToken: text('color_token').notNull(),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('categories_name_uq').on(table.name),
    uniqueIndex('categories_slug_uq').on(table.slug),
  ],
);
export type CategoryRow = typeof categories.$inferSelect;

export const categoryRules = sqliteTable(
  'category_rules',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    kind: text('kind').$type<CategoryRuleKind>().notNull(),
    pattern: text('pattern').notNull(),
    fields: text('fields').$type<CategoryRuleField>().notNull().default('ALL'),
    weight: integer('weight').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('category_rules_category_id_idx').on(table.categoryId),
    // Classification reads only active rules, on every ingest.
    index('category_rules_active_idx')
      .on(table.categoryId)
      .where(sql`${table.isActive} = 1`),
    check('category_rules_kind_check', sql.raw(inList('kind', CATEGORY_RULE_KINDS))),
    check('category_rules_fields_check', sql.raw(inList('fields', CATEGORY_RULE_FIELDS))),
    check('category_rules_weight_check', sql.raw(`"weight" between 0 and 100`)),
    check('category_rules_pattern_check', sql.raw(`length("pattern") between 1 and 200`)),
  ],
);
export type CategoryRuleRow = typeof categoryRules.$inferSelect;

export const eventCategories = sqliteTable(
  'event_categories',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    origin: text('origin').$type<CategoryOrigin>().notNull(),
    /** Set for RULE and SOURCE_TAG rows. No FK: deleting a rule re-classifies instead. */
    ruleId: text('rule_id'),
    confidence: real('confidence').notNull(),
    isSuppressed: integer('is_suppressed', { mode: 'boolean' }).notNull().default(false),
    assignedBy: text('assigned_by').references(() => users.id),
    assignedAt: integer('assigned_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.categoryId] }),
    index('event_categories_category_id_idx').on(table.categoryId),
    check('event_categories_origin_check', sql.raw(inList('origin', CATEGORY_ORIGINS))),
    check('event_categories_confidence_check', sql.raw(`"confidence" between 0 and 1`)),
    check(
      'event_categories_suppressed_check',
      sql.raw(`"is_suppressed" = 0 or "origin" = 'MANUAL'`),
    ),
  ],
);
export type EventCategoryRow = typeof eventCategories.$inferSelect;

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<TagKind>().notNull(),
    name: text('name').notNull(),
    normalized: text('normalized').notNull(),
    aliasesJson: text('aliases_json').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('tags_kind_normalized_uq').on(table.kind, table.normalized),
    check('tags_kind_check', sql.raw(inList('kind', TAG_KINDS))),
  ],
);
export type TagRow = typeof tags.$inferSelect;

export const eventTags = sqliteTable(
  'event_tags',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
    origin: text('origin').$type<CategoryOrigin>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.tagId] }),
    index('event_tags_tag_id_idx').on(table.tagId),
    check('event_tags_origin_check', sql.raw(inList('origin', CATEGORY_ORIGINS))),
  ],
);

/** What a professor cares about (§6.2); ranking's CATEGORY_MATCH / TAG_MATCH read it. */
export const userInterestTags = sqliteTable(
  'user_interest_tags',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.tagId] }),
    index('user_interest_tags_tag_id_idx').on(table.tagId),
  ],
);

/**
 * A pending or finished re-classification after a rule edit. `after_rowid` is
 * the resume point: each chunk commits its assignments and its new position in
 * one transaction, so a restart carries on where the last chunk ended.
 */
export const categoryReclassifyRuns = sqliteTable(
  'category_reclassify_runs',
  {
    id: text('id').primaryKey(),
    reason: text('reason').notNull(),
    requestedAt: integer('requested_at').notNull(),
    requestedBy: text('requested_by').references(() => users.id),
    afterRowid: integer('after_rowid').notNull().default(0),
    eventsDone: integer('events_done').notNull().default(0),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    index('category_reclassify_runs_pending_idx')
      .on(table.requestedAt)
      .where(sql`${table.finishedAt} is null`),
  ],
);
export type CategoryReclassifyRunRow = typeof categoryReclassifyRuns.$inferSelect;
