import {
  CHANGE_CAUSES,
  DATE_PRECISIONS,
  DEADLINE_KINDS,
  OVERRIDE_FIELDS,
  VALUE_ORIGINS,
  type ChangeCause,
  type DatePrecision,
  type DeadlineKind,
  type OverrideField,
  type ValueOrigin,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { events } from './events.js';
import { users } from './identity.js';

/** `'A', 'B'` — CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * Where an event's facts came from, and what was done to them (§6.2, R48).
 *
 * These four tables are why the app can answer "says who?". A scraped event is
 * an assembly of claims from several sources that may disagree; a professor may
 * correct any of them; and the corrections have to survive the next scrape.
 * `event_field_claims` records what each source said, `event_overrides` what a
 * person decided, and `event_changes` what actually moved and why — which is
 * also what drives the "deadline changed" notification (§12).
 *
 * They land here, with the schema, rather than with the code that fills them:
 * WP-10 resolves conflicts out of the claims, WP-16b draws the provenance
 * drawer from all three, and splitting one schema across three work packages
 * would mean three migrations rewriting each other's tables (R48).
 *
 * **`source_record_id` carries no foreign key, deliberately (R49).**
 * `source_records` arrives with WP-09a, and adding the constraint later would
 * mean rebuilding these tables — SQLite cannot add a foreign key in place. The
 * column is unconstrained TEXT holding a `source_records.id`; the repository
 * enforces the relation, and WP-09a does **not** rebuild these tables for it.
 */

/**
 * Every date an event has besides its start and end (§6.2 `event_deadlines`).
 *
 * Rows rather than columns because a hackathon routinely has four or five —
 * abstract, PPT, prototype, final submission, result — and each needs its own
 * precision and its own provenance. The start, end and registration deadline
 * stay on `events` because every query filters and sorts on them.
 */
export const eventDeadlines = sqliteTable(
  'event_deadlines',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    kind: text('kind').$type<DeadlineKind>().notNull(),
    /** What the source called it, shown as-is ("Round 2 submission"). */
    label: text('label').notNull(),
    dueAt: integer('due_at').notNull(),
    precision: text('precision').$type<DatePrecision>().notNull().default('UNKNOWN'),
    origin: text('origin').$type<ValueOrigin>().notNull().default('SOURCE'),
    /** `source_records.id`; no FK until WP-09a exists, and not then either (R49). */
    sourceRecordId: text('source_record_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('event_deadlines_event_id_idx').on(table.eventId),
    // The deadline evaluator's query: "everything falling due soon" (§12).
    index('event_deadlines_due_at_idx').on(table.dueAt),
    check('event_deadlines_kind_check', sql.raw(`"kind" in (${quoted(DEADLINE_KINDS)})`)),
    check(
      'event_deadlines_precision_check',
      sql.raw(`"precision" in (${quoted(DATE_PRECISIONS)})`),
    ),
    check('event_deadlines_origin_check', sql.raw(`"origin" in (${quoted(VALUE_ORIGINS)})`)),
  ],
);
export type EventDeadlineRow = typeof eventDeadlines.$inferSelect;

/**
 * What each source said about each field (§6.2 `event_field_claims`).
 *
 * One row per (event, field, source record), so two sources disagreeing about a
 * registration deadline is *data* rather than a race: both claims are kept,
 * `is_selected` marks the one currently on `events`, and `events.has_conflicts`
 * tells the UI to show the disagreement. WP-10 owns choosing.
 */
export const eventFieldClaims = sqliteTable(
  'event_field_claims',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    field: text('field').$type<OverrideField>().notNull(),
    /** The claimed value, JSON-encoded; NULL is a claim that the field is empty. */
    valueJson: text('value_json'),
    /** `source_records.id`; no FK (R49). */
    sourceRecordId: text('source_record_id').notNull(),
    observedAt: integer('observed_at').notNull(),
    /** True for the claim currently reflected on `events`. */
    isSelected: integer('is_selected', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('event_field_claims_event_id_idx').on(table.eventId),
    index('event_field_claims_source_record_id_idx').on(table.sourceRecordId),
    // One claim per source per field: a re-scrape updates, never accumulates.
    uniqueIndex('event_field_claims_event_field_source_uq').on(
      table.eventId,
      table.field,
      table.sourceRecordId,
    ),
    check('event_field_claims_field_check', sql.raw(`"field" in (${quoted(OVERRIDE_FIELDS)})`)),
  ],
);
export type EventFieldClaimRow = typeof eventFieldClaims.$inferSelect;

/**
 * A person's correction, which beats every source (§6.2 `event_overrides`).
 *
 * An override survives re-scrapes: the scraper writes claims, and the resolver
 * applies the override on top. `cleared_at` rather than a delete, so "the
 * deadline was corrected by hand in March and the correction was withdrawn in
 * April" stays answerable. A partial unique index keeps one *live* override per
 * field while letting the cleared ones pile up as history.
 */
export const eventOverrides = sqliteTable(
  'event_overrides',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    field: text('field').$type<OverrideField>().notNull(),
    /** The corrected value, JSON-encoded; NULL means "this field is empty". */
    valueJson: text('value_json'),
    /** Why, in the professor's words. Shown next to the value (WP-16b). */
    reason: text('reason'),
    setBy: text('set_by')
      .notNull()
      .references(() => users.id),
    setAt: integer('set_at').notNull(),
    clearedAt: integer('cleared_at'),
  },
  (table) => [
    index('event_overrides_event_id_idx').on(table.eventId),
    uniqueIndex('event_overrides_live_field_uq')
      .on(table.eventId, table.field)
      .where(sql`"cleared_at" is null`),
    check('event_overrides_field_check', sql.raw(`"field" in (${quoted(OVERRIDE_FIELDS)})`)),
  ],
);
export type EventOverrideRow = typeof eventOverrides.$inferSelect;

/**
 * What changed, when, and what caused it (§6.2 `event_changes`).
 *
 * Append-only by convention rather than by trigger — this is product history,
 * not the tamper-evident audit log (`audit_log`, R35), and the two answer
 * different questions: "what did this event's deadline used to be" versus "who
 * did what in this installation". §12's "deadline changed" notification reads
 * this table.
 */
export const eventChanges = sqliteTable(
  'event_changes',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    field: text('field').$type<OverrideField>().notNull(),
    oldValueJson: text('old_value_json'),
    newValueJson: text('new_value_json'),
    cause: text('cause').$type<ChangeCause>().notNull(),
    /** `source_records.id` for a SCRAPE cause; no FK (R49). */
    sourceRecordId: text('source_record_id'),
    /** The user for OVERRIDE/MANUAL; NULL when the scheduler did it. */
    changedBy: text('changed_by').references(() => users.id),
    detectedAt: integer('detected_at').notNull(),
  },
  (table) => [
    index('event_changes_event_id_idx').on(table.eventId),
    // "What changed since I last looked", which is how the digest is built.
    index('event_changes_detected_at_idx').on(table.detectedAt),
    check('event_changes_field_check', sql.raw(`"field" in (${quoted(OVERRIDE_FIELDS)})`)),
    check('event_changes_cause_check', sql.raw(`"cause" in (${quoted(CHANGE_CAUSES)})`)),
    // Something has to have changed, or there is no reason for the row.
    check(
      'event_changes_value_check',
      sql.raw(`"old_value_json" is not null or "new_value_json" is not null`),
    ),
  ],
);
export type EventChangeRow = typeof eventChanges.$inferSelect;
