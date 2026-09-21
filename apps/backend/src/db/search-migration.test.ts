import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureDataDirs, loadConfig } from '../platform/config.js';
import { openDatabase, type DatabaseHandle } from '../platform/db.js';
import { runMigrations } from '../platform/migrate.js';
import { migrationsDir, openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import { makeTempDir, removeTempDir } from '../testing/temp.js';

/**
 * Migrations 0013/0014: the FTS5 indexes and the triggers that keep them in
 * step with `events` (F6 — custom SQL, since Drizzle cannot express either).
 * §4.6 asks for two starting points: an empty database, and the previous
 * release's database with events already in it.
 */

const silent = pino({ enabled: false });
const temps: string[] = [];
const handles: { close(): void }[] = [];

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
  while (temps.length > 0) removeTempDir(temps.pop() ?? '');
});

function open(): MigratedDatabase {
  const database = openMigratedDatabase(silent, 'search-migration');
  handles.push(database);
  return database;
}

let seq = 0;
function insertEvent(db: DatabaseHandle, title: string, organizer: string | null = null): string {
  seq += 1;
  const id = `01920000-0000-7000-8000-${String(seq).padStart(12, '0')}`;
  db.raw
    .prepare(
      `INSERT INTO events (id, title, normalized_title, event_type, organizer_name,
        last_changed_at, first_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'HACKATHON', ?, 1, 1, 1, 1)`,
    )
    .run(id, title, title.toLowerCase(), organizer);
  return id;
}

const matches = (db: DatabaseHandle, index: 'event_fts' | 'event_fts_trigram', q: string): number =>
  (
    db.raw.prepare(`SELECT count(*) AS n FROM ${index} WHERE ${index} MATCH ?`).get(q) as {
      n: number;
    }
  ).n;

function objects(db: DatabaseHandle): string[] {
  return (
    db.raw
      .prepare(
        `SELECT type || ':' || name AS o FROM sqlite_master WHERE name LIKE '%search%' OR name LIKE 'event_fts%'`,
      )
      .all() as { o: string }[]
  ).map((row) => row.o);
}

const EXPECTED_OBJECTS = [
  'table:event_fts',
  'table:event_fts_trigram',
  'view:event_search_source',
  'trigger:events_search_ai',
  'trigger:events_search_ad',
  'trigger:events_search_au',
  'table:search_vocabulary',
  'table:search_aliases',
];

function integrityOk(db: DatabaseHandle): void {
  db.raw.prepare(`INSERT INTO event_fts (event_fts) VALUES ('integrity-check')`).run();
  db.raw
    .prepare(`INSERT INTO event_fts_trigram (event_fts_trigram) VALUES ('integrity-check')`)
    .run();
}

describe('from an empty database', () => {
  it('creates both indexes, the content view, all three triggers and the seeded aliases', () => {
    const { db } = open();
    expect(objects(db)).toEqual(expect.arrayContaining(EXPECTED_OBJECTS));
    expect(
      (
        db.raw.prepare('SELECT term FROM search_aliases ORDER BY term').all() as { term: string }[]
      ).map((row) => row.term),
    ).toEqual(['ctf', 'genai', 'ml']);
    for (const table of ['event_user_state', 'watchlist_items']) {
      expect(
        db.raw.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(table),
      ).toBeDefined();
    }
  });
});

describe('the triggers (F6)', () => {
  it('insert → findable in both indexes (a raw SQL insert included)', () => {
    const { db } = open();
    insertEvent(db, 'Smart India Hackathon', 'AICTE');
    expect(matches(db, 'event_fts', '"hackathon"')).toBe(1);
    expect(matches(db, 'event_fts_trigram', '"ackath"')).toBe(1);
    expect(matches(db, 'event_fts', '"aicte"')).toBe(1);
  });

  it('update the title → the old title no longer matches and the new one does', () => {
    const { db } = open();
    const id = insertEvent(db, 'Smart India Hackathon');
    db.raw.prepare(`UPDATE events SET title = 'Robotics League' WHERE id = ?`).run(id);
    expect(matches(db, 'event_fts', '"hackathon"')).toBe(0);
    expect(matches(db, 'event_fts_trigram', '"ackath"')).toBe(0);
    expect(matches(db, 'event_fts', '"robotics"')).toBe(1);
    expect(matches(db, 'event_fts_trigram', '"obotic"')).toBe(1);
    integrityOk(db);
  });

  it('an update that touches no indexed column leaves the index alone', () => {
    const { db } = open();
    const id = insertEvent(db, 'Smart India Hackathon');
    const before = (
      db.raw.prepare('SELECT count(*) AS n FROM event_fts_data').get() as { n: number }
    ).n;
    db.raw
      .prepare(`UPDATE events SET quality_score = 90, visibility = 'ADMIN_HIDDEN' WHERE id = ?`)
      .run(id);
    const after = (
      db.raw.prepare('SELECT count(*) AS n FROM event_fts_data').get() as { n: number }
    ).n;
    expect(after).toBe(before);
  });

  it('delete → no orphan rows in either index', () => {
    const { db } = open();
    const id = insertEvent(db, 'Smart India Hackathon', 'AICTE');
    insertEvent(db, 'Robotics League');
    db.raw.prepare('DELETE FROM events WHERE id = ?').run(id);
    expect(matches(db, 'event_fts', '"hackathon"')).toBe(0);
    expect(matches(db, 'event_fts_trigram', '"ackath"')).toBe(0);
    expect(
      (db.raw.prepare('SELECT count(*) AS n FROM event_fts_docsize').get() as { n: number }).n,
    ).toBe(1);
    integrityOk(db);
  });

  it('keeps the rowid mapping through a VACUUM INTO copy (what restores are made of)', () => {
    const { db, config } = open();
    const ids = ['Alpha Hackathon', 'Beta Hackathon', 'Gamma Ideathon'].map((title) =>
      insertEvent(db, title),
    );
    db.raw.prepare('DELETE FROM events WHERE id = ?').run(ids[1]); // leave a rowid gap
    const copy = path.join(config.dataDir, 'vacuumed.db');
    db.raw.prepare('VACUUM INTO ?').run(copy);
    const reopened = openDatabase(config, { logger: silent, file: copy });
    handles.push(reopened);
    const hit = reopened.raw
      .prepare(
        `SELECT e.title FROM event_fts f JOIN events e ON e.rowid = f.rowid WHERE event_fts MATCH '"ideathon"'`,
      )
      .all() as { title: string }[];
    expect(hit).toEqual([{ title: 'Gamma Ideathon' }]);
    integrityOk(reopened);
  });
});

describe('from the previous release (0012) with events already stored', () => {
  it('indexes the existing events and installs the triggers', () => {
    const dir = makeTempDir('search-upgrade');
    temps.push(dir);
    const previous = path.join(dir, 'migrations-0012');
    mkdirSync(path.join(previous, 'meta'), { recursive: true });
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir(), 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    const old = journal.entries.filter((entry) => entry.idx <= 12);
    writeFileSync(
      path.join(previous, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: old }),
    );
    for (const entry of old) {
      copyFileSync(
        path.join(migrationsDir(), `${entry.tag}.sql`),
        path.join(previous, `${entry.tag}.sql`),
      );
    }

    const config = loadConfig({
      argv: ['--data-dir', path.join(dir, 'data')],
      env: { COMPINTEL_CLIENT_SECRET: '0123456789abcdef0123456789abcdef' },
    });
    ensureDataDirs(config);
    const db = openDatabase(config, { logger: silent });
    handles.push(db);
    runMigrations(config, db, { migrationsDir: previous, logger: silent });
    expect(objects(db)).toEqual([]);
    insertEvent(db, 'Pre-existing Hackathon', 'IIT Bombay');

    const result = runMigrations(config, db, { migrationsDir: migrationsDir(), logger: silent });
    expect(result.applied).toBeGreaterThanOrEqual(2);
    expect(objects(db)).toEqual(expect.arrayContaining(EXPECTED_OBJECTS));
    expect(matches(db, 'event_fts', '"hackathon"')).toBe(1);
    expect(matches(db, 'event_fts_trigram', '"bomba"')).toBe(1);
    insertEvent(db, 'Fresh Ideathon');
    expect(matches(db, 'event_fts', '"ideathon"')).toBe(1);
    integrityOk(db);
  });
});

describe('the migration journal', () => {
  it('is strictly increasing in `when`, or the migrator silently skips a migration', () => {
    // drizzle-kit stamps `when` from the clock; 0012 was stamped by hand ahead
    // of it, and the migrator applies only entries newer than the last applied.
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir(), 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { when: number; tag: string }[] };
    for (let index = 1; index < journal.entries.length; index += 1) {
      const previous = journal.entries[index - 1];
      const current = journal.entries[index];
      expect(current?.when, `${current?.tag} after ${previous?.tag}`).toBeGreaterThan(
        previous?.when ?? 0,
      );
    }
  });
});
