import {
  ADAPTER_KINDS,
  COMPLIANCE_STATUSES,
  MATCH_METHODS,
  PRESENCES,
  SCRAPE_ERROR_KINDS,
  SCRAPE_OUTCOMES,
  SCRAPE_TRIGGERS,
  UUID_V7_PATTERN,
} from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPathAllowed } from '../domain/scraping/paths.js';
import { HttpCacheStore } from '../scraping/http/index.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import { silentLogger } from '../testing/scraping.js';
import { sources, sourceState, type SourceRow } from './schema/index.js';

/**
 * Migration 0005 (the four tables plus `http_cache`) and migration 0006 (the
 * five seed rows of D-26).
 *
 * The seed assertions are the important half. `docs/research/source-feasibility.md`
 * is the file whose verdicts bind, and a row that disagrees with it is a source
 * being scraped on a permission nobody granted — so every verdict, path, delay
 * and trust rank in it is checked here rather than trusted.
 */

let database: MigratedDatabase;

beforeAll(() => {
  database = openMigratedDatabase(silentLogger, 'sources-schema');
});

afterAll(() => {
  database.close();
});

interface TableInfo {
  name: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function columns(table: string): TableInfo[] {
  return database.db.raw.prepare(`pragma table_info(${table})`).all() as TableInfo[];
}

function indexes(table: string): { name: string; unique: number }[] {
  return database.db.raw.prepare(`pragma index_list(${table})`).all() as {
    name: string;
    unique: number;
  }[];
}

function ddl(table: string): string {
  const row = database.db.raw
    .prepare(`select sql from sqlite_master where type = 'table' and name = ?`)
    .get(table) as { sql: string } | undefined;
  return row?.sql ?? '';
}

function seed(key: string): SourceRow {
  const row = database.db.drizzle
    .select()
    .from(sources)
    .all()
    .find((entry) => entry.key === key);
  if (row === undefined) {
    throw new Error(`the ${key} seed row is missing`);
  }
  return row;
}

describe('the four tables §6.2 names', () => {
  it.each(['sources', 'source_state', 'scrape_runs', 'source_records', 'http_cache'])(
    'creates %s',
    (table) => {
      expect(columns(table).length).toBeGreaterThan(0);
    },
  );

  it('gives sources every column §6.2 lists', () => {
    const names = columns('sources').map((column) => column.name);
    expect(names).toEqual([
      'id',
      'key',
      'name',
      'adapter',
      'config_json',
      'is_enabled',
      'cadence_minutes',
      'manual_min_interval_minutes',
      'min_delay_ms',
      'max_requests_per_run',
      'allowed_paths_json',
      'attribution_text',
      'trust_rank',
      'compliance_status',
      'compliance_notes',
      'compliance_reviewed_at',
      'compliance_reviewed_by',
      'created_at',
      'updated_at',
      'version',
    ]);
  });

  it('gives scrape_runs the five item counters plus listing_complete', () => {
    const names = columns('scrape_runs').map((column) => column.name);
    for (const column of [
      'listing_complete',
      'requests_made',
      'items_seen',
      'items_new',
      'items_updated',
      'items_unchanged',
      'items_invalid',
      'duration_ms',
    ]) {
      expect(names).toContain(column);
    }
  });

  it('gives http_cache exactly the columns R58 names', () => {
    expect(columns('http_cache').map((column) => column.name)).toEqual([
      'url',
      'etag',
      'last_modified',
      'fetched_at',
      'content_hash',
    ]);
  });

  it('makes (source_id, external_key) unique on source_records', () => {
    const unique = indexes('source_records').filter((index) => index.unique === 1);
    expect(unique.map((index) => index.name)).toContain('source_records_source_external_key_idx');
  });

  it('makes sources.key unique', () => {
    expect(
      indexes('sources')
        .filter((index) => index.unique === 1)
        .map((i) => i.name),
    ).toContain('sources_key_idx');
  });

  it('indexes what §6.2 and §7.6 query on', () => {
    expect(indexes('scrape_runs').map((index) => index.name)).toContain(
      'scrape_runs_source_started_idx',
    );
    expect(indexes('source_records').map((index) => index.name)).toContain(
      'source_records_presence_idx',
    );
    expect(indexes('source_state').map((index) => index.name)).toContain(
      'source_state_next_due_at_idx',
    );
  });
});

describe('the CHECK constraints come from the contracts enums', () => {
  it.each([
    ['sources', 'adapter', ADAPTER_KINDS],
    ['sources', 'compliance_status', COMPLIANCE_STATUSES],
    ['scrape_runs', 'trigger', SCRAPE_TRIGGERS],
    ['scrape_runs', 'outcome', SCRAPE_OUTCOMES],
    ['scrape_runs', 'error_kind', SCRAPE_ERROR_KINDS],
    ['source_state', 'last_error_kind', SCRAPE_ERROR_KINDS],
    ['source_records', 'presence', PRESENCES],
    ['source_records', 'match_method', MATCH_METHODS],
  ] as const)('%s.%s lists every value', (table, column, values) => {
    const sql = ddl(table);
    for (const value of values) {
      expect(sql).toContain(`'${value}'`);
    }
    expect(sql).toContain(`"${column}"`);
  });

  it('refuses a compliance status that is not in the enum', () => {
    expect(() =>
      database.db.raw
        .prepare(
          `insert into sources (id, key, name, adapter, cadence_minutes,
             manual_min_interval_minutes, max_requests_per_run, compliance_status,
             created_at, updated_at)
           values ('x', 'x', 'X', 'CTFTIME_API', 30, 10, 5, 'PROBABLY_FINE', 0, 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a second record with the same external key for one source', () => {
    const source = seed('ctftime');
    const insert = database.db.raw.prepare(
      `insert into source_records (id, source_id, external_key, url, first_seen_at,
         last_seen_at, last_fetched_at, content_hash, payload_json)
       values (?, ?, 'dup', 'https://example.test/', 0, 0, 0, 'h', '{}')`,
    );
    insert.run('r-a', source.id);
    expect(() => {
      insert.run('r-b', source.id);
    }).toThrow(/UNIQUE constraint failed/);
    database.db.raw.prepare(`delete from source_records where id = 'r-a'`).run();
  });
});

describe('the five seed rows (D-26, migration 0006)', () => {
  it('seeds exactly the five sources ADR-0016 names', () => {
    expect(
      database.db.drizzle
        .select()
        .from(sources)
        .all()
        .map((row) => row.key)
        .sort(),
    ).toEqual(['clist', 'ctftime', 'devfolio', 'devpost', 'unstop']);
  });

  it('gives every seed a fixed, valid UUIDv7 and a health row', () => {
    for (const row of database.db.drizzle.select().from(sources).all()) {
      expect(row.id).toMatch(UUID_V7_PATTERN);
      const state = database.db.drizzle
        .select()
        .from(sourceState)
        .all()
        .find((entry) => entry.sourceId === row.id);
      expect(state).toBeDefined();
      expect(state?.consecutiveFailures).toBe(0);
    }
  });

  it('matches source-feasibility.md on every verdict', () => {
    expect(seed('ctftime').complianceStatus).toBe('APPROVED_WITH_LIMITS');
    expect(seed('clist').complianceStatus).toBe('APPROVED_WITH_LIMITS');
    expect(seed('devfolio').complianceStatus).toBe('APPROVED_WITH_LIMITS');
    expect(seed('unstop').complianceStatus).toBe('MANUAL_IMPORT_ONLY');
    expect(seed('devpost').complianceStatus).toBe('MANUAL_IMPORT_ONLY');
  });

  it('enables CTFtime, CLIST and Devfolio; Unstop and Devpost stay off', () => {
    expect(seed('ctftime').isEnabled).toBe(true);
    // WP-11 (migration 0009): enabled, because with no key (U4) it records
    // BLOCKED_BY_POLICY and makes zero requests — a state, not a failure.
    expect(seed('clist').isEnabled).toBe(true);
    // WP-12 (migration 0010): its adapter exists.
    expect(seed('devfolio').isEnabled).toBe(true);
    expect(seed('unstop').isEnabled).toBe(false);
    expect(seed('devpost').isEnabled).toBe(false);
  });

  it('matches §7.2 on cadence and the manual floor (D-27)', () => {
    expect(seed('ctftime')).toMatchObject({ cadenceMinutes: 30, manualMinIntervalMinutes: 10 });
    expect(seed('clist')).toMatchObject({ cadenceMinutes: 30, manualMinIntervalMinutes: 10 });
    expect(seed('devfolio')).toMatchObject({ cadenceMinutes: 15, manualMinIntervalMinutes: 5 });
    expect(seed('unstop')).toMatchObject({ cadenceMinutes: 15, manualMinIntervalMinutes: 5 });
  });

  it('matches §7.2 on the per-source delay (A9/D-28)', () => {
    // CTFtime's robots.txt says Crawl-delay: 10.
    expect(seed('ctftime').minDelayMs).toBe(10_000);
    // CLIST allows 10 requests a minute.
    expect(seed('clist').minDelayMs).toBe(6_000);
    expect(seed('devfolio').minDelayMs).toBe(3_000);
  });

  it('gives CTFtime only its two API paths, and nothing else on the host', () => {
    const paths = JSON.parse(seed('ctftime').allowedPathsJson) as string[];
    // Migration 0007 added the denial: the grammar is prefix-only, so without
    // it the listing entry also authorized every path below an event id.
    expect(paths).toEqual([
      'ctftime.org/api/v1/events/',
      'ctftime.org/api/v1/events/{id}/',
      '!ctftime.org/api/v1/events/{id}/{below}',
    ]);
    expect(isPathAllowed(new URL('https://ctftime.org/api/v1/events/'), paths)).toBe(true);
    expect(
      isPathAllowed(
        new URL('https://ctftime.org/api/v1/events/?limit=100&start=1&finish=2'),
        paths,
      ),
    ).toBe(true);
    expect(isPathAllowed(new URL('https://ctftime.org/api/v1/events/1234/'), paths)).toBe(true);
    expect(isPathAllowed(new URL('https://ctftime.org/api/v1/events/1234/x/'), paths)).toBe(false);
    expect(isPathAllowed(new URL('https://ctftime.org/event/1234/'), paths)).toBe(false);
    expect(isPathAllowed(new URL('https://ctftime.org/user/1/'), paths)).toBe(false);
    expect(seed('ctftime').maxRequestsPerRun).toBe(6);
  });

  it('lets Devfolio reach its sub-domains but never api.devfolio.co', () => {
    const paths = JSON.parse(seed('devfolio').allowedPathsJson) as string[];
    expect(isPathAllowed(new URL('https://devfolio.co/hackathons'), paths)).toBe(true);
    expect(isPathAllowed(new URL('https://recursiveacm.devfolio.co/'), paths)).toBe(true);
    expect(isPathAllowed(new URL('https://api.devfolio.co/hackathons'), paths)).toBe(false);
  });

  it('gives the two manual-only sources an empty allowance', () => {
    for (const key of ['unstop', 'devpost']) {
      expect(JSON.parse(seed(key).allowedPathsJson)).toEqual([]);
    }
  });

  it('ranks trust as §7.5 does: platform > aggregator', () => {
    expect(seed('devfolio').trustRank).toBe(60);
    expect(seed('unstop').trustRank).toBe(60);
    expect(seed('ctftime').trustRank).toBe(40);
    expect(seed('clist').trustRank).toBe(20);
    expect(seed('ctftime').trustRank).toBeGreaterThan(seed('clist').trustRank);
    expect(seed('devfolio').trustRank).toBeGreaterThan(seed('ctftime').trustRank);
  });

  it('attributes the two sources ADR-0016 says to credit (D-32)', () => {
    expect(seed('ctftime').attributionText).toContain('CTFtime');
    expect(seed('clist').attributionText).toContain('CLIST');
  });

  it('quotes the clauses each verdict rests on', () => {
    expect(seed('ctftime').complianceNotes).toContain('data analysis and mobile applications only');
    expect(seed('ctftime').complianceNotes).toContain('ai-train=no');
    expect(seed('clist').complianceNotes).toContain('U4');
    expect(seed('devfolio').complianceNotes).toContain('api.devfolio.co');
    expect(seed('unstop').complianceNotes).toContain('U3');
    expect(seed('devpost').complianceNotes).toContain('scrape');
  });

  it('records who reviewed each verdict and when', () => {
    for (const row of database.db.drizzle.select().from(sources).all()) {
      expect(row.complianceReviewedBy).toContain('source-feasibility.md');
      expect(row.complianceReviewedAt).not.toBeNull();
    }
  });

  it('starts every seed at version 1, so an adapter WP can upsert without clobbering it', () => {
    for (const row of database.db.drizzle.select().from(sources).all()) {
      expect(row.version).toBe(1);
    }
  });
});

describe('http_cache (R58)', () => {
  it('stores, reads back and refreshes a URL’s validators', () => {
    const store = new HttpCacheStore(database.db);
    const url = 'https://ctftime.org/api/v1/events/';
    expect(store.get(url)).toBeUndefined();

    store.put(url, { etag: '"v1"', lastModified: 'Mon, 21 Sep 2026 10:00:00 GMT' }, 'hash-1', 100);
    expect(store.get(url)).toEqual({
      etag: '"v1"',
      lastModified: 'Mon, 21 Sep 2026 10:00:00 GMT',
      contentHash: 'hash-1',
    });

    store.put(url, { etag: '"v2"' }, 'hash-2', 200);
    expect(store.get(url)).toMatchObject({ etag: '"v2"', lastModified: null });

    // A 304 moves only `fetched_at`.
    store.touch(url, 300);
    expect(store.get(url)?.contentHash).toBe('hash-2');
  });
});
