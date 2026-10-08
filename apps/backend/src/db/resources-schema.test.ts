import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuid7 } from '../platform/ids.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Migration 0027 (WP-20b, R103): `resources` holds references only, its enums
 * and lengths are CHECKed, a machine label belongs to a local path alone, and
 * owners are found through the (owner_kind, owner_id) index.
 */

let database: MigratedDatabase;
let userId: string;
beforeAll(() => {
  database = openMigratedDatabase(undefined, 'resources-schema');
  userId = uuid7();
  database.db.raw
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, 'r@example.edu', 'R', 'x', 'ACTIVE', 0, 0)`,
    )
    .run(userId);
});
afterAll(() => {
  database.close();
});

function insert(patch: Record<string, unknown> = {}): void {
  const row = {
    id: uuid7(),
    owner_kind: 'ENGAGEMENT',
    owner_id: uuid7(),
    kind: 'URL',
    label: 'Brief',
    uri: 'https://example.org/brief',
    machine_label: null,
    added_by: userId,
    added_at: 1,
    ...patch,
  };
  database.db.raw
    .prepare(
      `INSERT INTO resources (id, owner_kind, owner_id, kind, label, uri, machine_label, added_by, added_at)
       VALUES (@id, @owner_kind, @owner_id, @kind, @label, @uri, @machine_label, @added_by, @added_at)`,
    )
    .run(row);
}

describe('resources (migration 0027)', () => {
  it('takes a reference, UNCHECKED at version 1', () => {
    const id = uuid7();
    insert({ id });
    expect(
      database.db.raw.prepare('SELECT check_status, version FROM resources WHERE id = ?').get(id),
    ).toEqual({ check_status: 'UNCHECKED', version: 1 });
    insert({ kind: 'LOCAL_PATH', uri: 'C:\\Docs\\deck.pptx', machine_label: 'LAB-PC-07' });
  });

  it('refuses unknown kinds, owners and statuses', () => {
    expect(() => {
      insert({ kind: 'FTP' });
    }).toThrow(/CHECK/);
    expect(() => {
      insert({ owner_kind: 'TEAM' });
    }).toThrow(/CHECK/);
    expect(() => {
      database.db.raw.prepare("UPDATE resources SET check_status = 'BROKEN' WHERE rowid = 1").run();
    }).toThrow(/CHECK/);
  });

  it('bounds the uri and label, and keeps a machine label to local paths', () => {
    expect(() => {
      insert({ uri: `https://example.org/${'a'.repeat(2048)}` });
    }).toThrow(/CHECK/);
    expect(() => {
      insert({ label: 'x'.repeat(121) });
    }).toThrow(/CHECK/);
    expect(() => {
      insert({ machine_label: 'LAB-PC-07' });
    }).toThrow(/CHECK/);
  });

  it('finds an owner’s resources through its index', () => {
    const plan = database.db.raw
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM resources WHERE owner_kind = 'STAGE' AND owner_id = ?",
      )
      .all('x') as { detail: string }[];
    expect(plan.map((row) => row.detail).join(' ')).toContain('resources_owner_idx');
  });
});
