import {
  CANCELLATIONS,
  CHANGE_CAUSES,
  DATE_PRECISIONS,
  DEADLINE_KINDS,
  EVENT_MODES,
  EVENT_TYPES,
  GEO_PRECISIONS,
  INSTITUTION_KINDS,
  ORGANIZER_KINDS,
  OVERRIDE_FIELDS,
  RECURRENCES,
  VALUE_ORIGINS,
  VISIBILITIES,
} from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { uuid7 } from '../platform/ids.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Migration 0004 — the event schema (§6.2 "Events" and "Places", ruling R48).
 *
 * Two things are under test and they are different. First, that the shipped SQL
 * says what §6.2 says: every column and every index, asserted against an
 * explicit list rather than a snapshot, so a column that quietly disappears
 * fails here and not in a WP-15a query six weeks from now. Second, that the
 * CHECK constraints actually refuse what they are meant to refuse — a constraint
 * nobody has seen reject anything is a constraint nobody can trust.
 */

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(): MigratedDatabase {
  database = openMigratedDatabase(undefined, 'events-schema');
  return database;
}

function columnsOf(h: MigratedDatabase, table: string): string[] {
  return (h.db.raw.pragma(`table_info(${table})`) as { name: string }[])
    .map((row) => row.name)
    .sort();
}

function indexesOf(h: MigratedDatabase, table: string): string[] {
  return (
    h.db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
      .all(table) as { name: string | null }[]
  )
    .map((row) => row.name)
    .filter((name): name is string => name !== null && !name.startsWith('sqlite_autoindex'))
    .sort();
}

/** The `CREATE TABLE` text, which is where SQLite keeps the CHECK clauses. */
function ddlOf(h: MigratedDatabase, table: string): string {
  const row = h.db.raw
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  expect(row, `${table} should exist`).toBeDefined();
  return row?.sql ?? '';
}

/** `'A', 'B'` — the form the migration writes an enum CHECK in. */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

const NOW = 1_790_000_000_000;

/** A minimal valid `events` row; a test overrides only the column it is about. */
function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid7(),
    title: 'Example',
    normalized_title: 'example',
    event_type: 'HACKATHON',
    last_changed_at: NOW,
    first_seen_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function insertEvent(h: MigratedDatabase, overrides: Record<string, unknown> = {}): string {
  const row = eventRow(overrides);
  const names = Object.keys(row);
  h.db.raw
    .prepare(
      `insert into events (${names.join(', ')}) values (${names.map((name) => `:${name}`).join(', ')})`,
    )
    .run(row);
  return row.id as string;
}

describe('the tables ruling R48 creates', () => {
  it('creates all seven in one migration', () => {
    const h = open();
    const names = (
      h.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    for (const table of [
      'event_series',
      'events',
      'event_deadlines',
      'event_field_claims',
      'event_overrides',
      'event_changes',
      'institutions',
    ]) {
      expect(names, table).toContain(table);
    }
  });
});

describe('the events table matches §6.2 column for column', () => {
  /**
   * §6.2's ten column groups, flattened and sorted. Written out rather than
   * snapshotted so that adding a column is a deliberate edit here, with the
   * group it belongs to visible next to it.
   */
  const EXPECTED_COLUMNS = [
    // Identity
    'id',
    'title',
    'normalized_title',
    'edition_year',
    'series_id',
    'event_type',
    'is_recurring_round',
    // Organizer
    'organizer_name',
    'organizer_kind',
    'host_institution_id',
    // Content
    'summary',
    'description_md',
    'prize_text',
    'prize_total_minor',
    'prize_currency',
    'eligibility_text',
    'eligibility_json',
    'requirements_text',
    'submission_requirements_text',
    // Format & place
    'mode',
    'venue_name',
    'city',
    'state',
    'country_code',
    'lat',
    'lon',
    'geo_precision',
    // Dates
    'timezone',
    'registration_opens_at',
    'registration_deadline_at',
    'registration_deadline_precision',
    'starts_at',
    'ends_at',
    'submission_deadline_at',
    'date_precision',
    // Team & fee
    'team_min',
    'team_max',
    'fee_known',
    'fee_minor',
    'fee_currency',
    'fee_text',
    // Links
    'official_url',
    'registration_url',
    // State
    'cancellation',
    'cancellation_origin',
    'visibility',
    'merged_into_event_id',
    'policy_reason',
    // Quality
    'quality_score',
    'has_conflicts',
    'last_verified_at',
    'last_changed_at',
    'first_seen_at',
    // Audit
    'created_at',
    'updated_at',
    'version',
  ].sort();

  it('has exactly those columns, no more and no fewer', () => {
    expect(columnsOf(open(), 'events')).toStrictEqual(EXPECTED_COLUMNS);
  });

  /** §6.2's Indexes row, in its order. */
  it('carries the nine indexes §6.2 lists, plus the three WP-10 added for the candidate slice', () => {
    expect(indexesOf(open(), 'events')).toStrictEqual(
      [
        // WP-10 (migration 0008): the edition guard and §7.5's URL rule.
        'events_edition_year_idx',
        'events_official_url_idx',
        'events_registration_url_idx',
        'events_registration_deadline_at_idx',
        'events_starts_at_idx',
        'events_event_type_idx',
        'events_mode_idx',
        'events_country_code_idx',
        'events_lat_lon_idx',
        'events_visibility_idx',
        'events_series_id_idx',
        'events_normalized_title_idx',
      ].sort(),
    );
  });

  it('gives the other six tables the columns §6.2 lists', () => {
    const h = open();
    expect(columnsOf(h, 'event_series')).toStrictEqual(
      [
        'id',
        'name',
        'organizer_name',
        'recurrence',
        'is_rated_contest',
        'created_at',
        'updated_at',
      ].sort(),
    );
    expect(columnsOf(h, 'event_deadlines')).toStrictEqual(
      [
        'id',
        'event_id',
        'kind',
        'label',
        'due_at',
        'precision',
        'origin',
        'source_record_id',
        'created_at',
        'updated_at',
      ].sort(),
    );
    expect(columnsOf(h, 'event_field_claims')).toStrictEqual(
      [
        'id',
        'event_id',
        'field',
        'value_json',
        'source_record_id',
        'observed_at',
        'is_selected',
        // WP-10 (migration 0008): R63 alternate claims.
        'is_alternate',
        'note',
      ].sort(),
    );
    expect(columnsOf(h, 'event_overrides')).toStrictEqual(
      ['id', 'event_id', 'field', 'value_json', 'reason', 'set_by', 'set_at', 'cleared_at'].sort(),
    );
    expect(columnsOf(h, 'event_changes')).toStrictEqual(
      [
        'id',
        'event_id',
        'field',
        'old_value_json',
        'new_value_json',
        'cause',
        'source_record_id',
        'changed_by',
        'detected_at',
      ].sort(),
    );
    expect(columnsOf(h, 'institutions')).toStrictEqual(
      [
        'id',
        'name',
        'short_name',
        'kind',
        'city',
        'state',
        'country_code',
        'lat',
        'lon',
        'website_domain',
        'aliases_json',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });
});

describe('every enum CHECK is written from the contracts list', () => {
  /**
   * This is the test that keeps the three copies of an enum in step: the zod
   * schema the API validates against, the TypeScript union the UI switches on,
   * and the CHECK the database enforces. A value added to contracts without a
   * migration fails here.
   */
  it.each([
    ['events', 'event_type', EVENT_TYPES],
    ['events', 'organizer_kind', ORGANIZER_KINDS],
    ['events', 'mode', EVENT_MODES],
    ['events', 'geo_precision', GEO_PRECISIONS],
    ['events', 'date_precision', DATE_PRECISIONS],
    ['events', 'registration_deadline_precision', DATE_PRECISIONS],
    ['events', 'cancellation', CANCELLATIONS],
    ['events', 'cancellation_origin', VALUE_ORIGINS],
    ['events', 'visibility', VISIBILITIES],
    ['event_series', 'recurrence', RECURRENCES],
    ['event_deadlines', 'kind', DEADLINE_KINDS],
    ['event_deadlines', 'precision', DATE_PRECISIONS],
    ['event_deadlines', 'origin', VALUE_ORIGINS],
    ['event_field_claims', 'field', OVERRIDE_FIELDS],
    ['event_overrides', 'field', OVERRIDE_FIELDS],
    ['event_changes', 'field', OVERRIDE_FIELDS],
    ['event_changes', 'cause', CHANGE_CAUSES],
    ['institutions', 'kind', INSTITUTION_KINDS],
  ])('%s.%s lists exactly the contracts values', (table, column, values) => {
    expect(ddlOf(open(), table)).toContain(`"${column}" in (${quoted(values)})`);
  });
});

describe('the CHECK constraints refuse what they are for', () => {
  it('refuses an out-of-enum value on every enum column', () => {
    const h = open();
    for (const column of [
      'event_type',
      'organizer_kind',
      'mode',
      'geo_precision',
      'date_precision',
      'registration_deadline_precision',
      'cancellation',
      'visibility',
    ]) {
      expect(() => insertEvent(h, { [column]: 'NOT_A_VALUE' }), column).toThrow(
        /CHECK constraint/i,
      );
    }
  });

  it('accepts NULL money and refuses a negative amount', () => {
    const h = open();
    // Unknown is NULL, never 0 (§6.1).
    expect(() => insertEvent(h, { fee_minor: null, prize_total_minor: null })).not.toThrow();
    expect(() => insertEvent(h, { prize_total_minor: -1, prize_currency: 'INR' })).toThrow(
      /CHECK constraint/i,
    );
    expect(() => insertEvent(h, { fee_known: 1, fee_minor: -1, fee_currency: 'INR' })).toThrow(
      /CHECK constraint/i,
    );
  });

  it('refuses a known fee with no amount, and accepts a known fee of zero', () => {
    const h = open();
    expect(() => insertEvent(h, { fee_known: 1 })).toThrow(/CHECK constraint/i);
    // Free is a price.
    expect(() => insertEvent(h, { fee_known: 1, fee_minor: 0, fee_currency: 'INR' })).not.toThrow();
  });

  it('refuses a prize total with no currency', () => {
    expect(() => insertEvent(open(), { prize_total_minor: 100 })).toThrow(/CHECK constraint/i);
  });

  it('refuses a team range whose minimum exceeds its maximum', () => {
    const h = open();
    expect(() => insertEvent(h, { team_min: 5, team_max: 2 })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { team_min: 2, team_max: 5 })).not.toThrow();
  });

  it('refuses a quality score outside 0–100 and a summary over 500 characters', () => {
    const h = open();
    expect(() => insertEvent(h, { quality_score: 101 })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { summary: 'x'.repeat(501) })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { summary: 'x'.repeat(500) })).not.toThrow();
  });

  it('refuses coordinates off the globe and a lower-case country code', () => {
    const h = open();
    expect(() => insertEvent(h, { lat: 91 })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { lon: -181 })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { country_code: 'in' })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { country_code: 'IN' })).not.toThrow();
  });

  it('refuses an end before a start', () => {
    const h = open();
    expect(() => insertEvent(h, { starts_at: NOW, ends_at: NOW - 1 })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { starts_at: NOW, ends_at: NOW })).not.toThrow();
  });

  it('keeps MERGED and merged_into_event_id in step', () => {
    const h = open();
    const target = insertEvent(h);
    // MERGED with nowhere to point, and a pointer without MERGED, are both wrong.
    expect(() => insertEvent(h, { visibility: 'MERGED' })).toThrow(/CHECK constraint/i);
    expect(() => insertEvent(h, { merged_into_event_id: target })).toThrow(/CHECK constraint/i);
    expect(() =>
      insertEvent(h, { visibility: 'MERGED', merged_into_event_id: target }),
    ).not.toThrow();
  });

  it('refuses an event_changes row where nothing changed', () => {
    const h = open();
    const eventId = insertEvent(h);
    expect(() =>
      h.db.raw
        .prepare(
          `insert into event_changes (id, event_id, field, old_value_json, new_value_json, cause, detected_at)
           values (?, ?, 'title', null, null, 'SCRAPE', ?)`,
        )
        .run(uuid7(), eventId, NOW),
    ).toThrow(/CHECK constraint/i);
  });
});

describe('foreign keys, and the one ruling R49 deliberately omits', () => {
  it('enforces events.series_id', () => {
    const h = open();
    expect(h.db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => insertEvent(h, { series_id: uuid7() })).toThrow(/FOREIGN KEY constraint/i);
  });

  it('enforces events.host_institution_id and events.merged_into_event_id', () => {
    const h = open();
    expect(() => insertEvent(h, { host_institution_id: uuid7() })).toThrow(
      /FOREIGN KEY constraint/i,
    );
    expect(() => insertEvent(h, { visibility: 'MERGED', merged_into_event_id: uuid7() })).toThrow(
      /FOREIGN KEY constraint/i,
    );
  });

  it('enforces event_deadlines.event_id', () => {
    const h = open();
    expect(() =>
      h.db.raw
        .prepare(
          `insert into event_deadlines (id, event_id, kind, label, due_at, created_at, updated_at)
           values (?, ?, 'REGISTRATION', 'Register by', ?, ?, ?)`,
        )
        .run(uuid7(), uuid7(), NOW, NOW, NOW),
    ).toThrow(/FOREIGN KEY constraint/i);
  });

  /**
   * R49: `source_records` arrives with WP-09a, and SQLite cannot add a foreign
   * key to an existing table, so these columns are unconstrained TEXT and the
   * repository enforces the relation. This test is the record of that being
   * deliberate — if someone "fixes" it later, they have to delete this first.
   */
  it('does NOT enforce source_record_id anywhere (R49)', () => {
    const h = open();
    const eventId = insertEvent(h);
    const orphan = uuid7();

    expect(() =>
      h.db.raw
        .prepare(
          `insert into event_deadlines (id, event_id, kind, label, due_at, source_record_id, created_at, updated_at)
           values (?, ?, 'REGISTRATION', 'Register by', ?, ?, ?, ?)`,
        )
        .run(uuid7(), eventId, NOW, orphan, NOW, NOW),
    ).not.toThrow();

    expect(() =>
      h.db.raw
        .prepare(
          `insert into event_field_claims (id, event_id, field, value_json, source_record_id, observed_at, is_selected)
           values (?, ?, 'title', '"x"', ?, ?, 1)`,
        )
        .run(uuid7(), eventId, orphan, NOW),
    ).not.toThrow();

    expect(() =>
      h.db.raw
        .prepare(
          `insert into event_changes (id, event_id, field, old_value_json, new_value_json, cause, source_record_id, detected_at)
           values (?, ?, 'title', '"a"', '"b"', 'SCRAPE', ?, ?)`,
        )
        .run(uuid7(), eventId, orphan, NOW),
    ).not.toThrow();

    // And no FK on those columns is declared at all.
    for (const table of ['event_deadlines', 'event_field_claims', 'event_changes']) {
      const keys = h.db.raw.pragma(`foreign_key_list(${table})`) as { from: string }[];
      expect(
        keys.map((key) => key.from),
        `${table} should declare no FK on source_record_id`,
      ).not.toContain('source_record_id');
    }
  });

  it('keeps one live override per field, and any number of cleared ones', () => {
    const h = open();
    const eventId = insertEvent(h);
    const userId = uuid7();
    h.db.raw
      .prepare(
        `insert into users (id, email, display_name, password_hash, created_at, updated_at)
         values (?, 'a@b.local', 'A', 'x', ?, ?)`,
      )
      .run(userId, NOW, NOW);

    const addOverride = (clearedAt: number | null): void => {
      h.db.raw
        .prepare(
          `insert into event_overrides (id, event_id, field, value_json, set_by, set_at, cleared_at)
           values (?, ?, 'title', '"x"', ?, ?, ?)`,
        )
        .run(uuid7(), eventId, userId, NOW, clearedAt);
    };

    addOverride(null);
    // A second *live* override of the same field would mean two answers.
    expect(() => {
      addOverride(null);
    }).toThrow(/UNIQUE constraint/i);
    // Cleared ones are history and may pile up.
    expect(() => {
      addOverride(NOW);
      addOverride(NOW + 1);
    }).not.toThrow();
  });

  it('enforces event_overrides.set_by', () => {
    const h = open();
    const eventId = insertEvent(h);
    expect(() =>
      h.db.raw
        .prepare(
          `insert into event_overrides (id, event_id, field, value_json, set_by, set_at)
           values (?, ?, 'title', '"x"', ?, ?)`,
        )
        .run(uuid7(), eventId, uuid7(), NOW),
    ).toThrow(/FOREIGN KEY constraint/i);
  });
});
