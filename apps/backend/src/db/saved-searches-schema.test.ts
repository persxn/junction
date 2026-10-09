import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuid7 } from '../platform/ids.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Migration 0031 (WP-24, R112): one name per owner, a match set keyed
 * (search, event), and deleting a search takes its matches with it.
 */

let database: MigratedDatabase;
let userId: string;
const raw = () => database.db.raw;

beforeAll(() => {
  database = openMigratedDatabase(undefined, 'saved-searches-schema');
  userId = uuid7();
  raw()
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, 's@example.edu', 'S', 'x', 'ACTIVE', 0, 0)`,
    )
    .run(userId);
});
afterAll(() => {
  database.close();
});

function search(name: string, owner = userId): string {
  const id = uuid7();
  raw()
    .prepare(
      `INSERT INTO saved_searches (id, user_id, name, query_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', 0, 0)`,
    )
    .run(id, owner, name);
  return id;
}

function event(): string {
  const id = uuid7();
  raw()
    .prepare(
      `INSERT INTO events (id, title, normalized_title, event_type, visibility, cancellation,
         last_changed_at, first_seen_at, created_at, updated_at)
       VALUES (?, 'Synthetic', 'synthetic', 'HACKATHON', 'VISIBLE', 'NONE', 0, 0, 0, 0)`,
    )
    .run(id);
  return id;
}

describe('saved_searches (migration 0031)', () => {
  it('defaults alerts on and version 1', () => {
    const id = search('Defaults');
    expect(
      raw()
        .prepare('SELECT notify_on_new AS n, version AS v FROM saved_searches WHERE id = ?')
        .get(id),
    ).toStrictEqual({ n: 1, v: 1 });
  });

  it('refuses a second search with the same name for the same owner', () => {
    search('Twice');
    expect(() => search('Twice')).toThrow(/UNIQUE/);
  });

  it('keeps one match per (search, event) and cascades on delete', () => {
    const id = search('Cascade');
    const eventId = event();
    const insert = raw().prepare(
      `INSERT INTO saved_search_matches (saved_search_id, event_id, first_matched_at) VALUES (?, ?, 1)`,
    );
    insert.run(id, eventId);
    expect(() => insert.run(id, eventId)).toThrow(/UNIQUE|PRIMARY/);
    raw().prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
    expect(
      raw()
        .prepare('SELECT count(*) AS n FROM saved_search_matches WHERE saved_search_id = ?')
        .get(id),
    ).toStrictEqual({ n: 0 });
  });
});
