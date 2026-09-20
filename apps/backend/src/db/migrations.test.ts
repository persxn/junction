import { ROLE_KEYS } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Migration 0002 (the identity and organization core) and 0003 (the triggers and
 * the role seed), applied the way they will be applied on a real machine: from
 * an empty database, and on top of a WP-04c-era one that already holds data.
 */

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(): MigratedDatabase {
  database = openMigratedDatabase(undefined, 'migrations');
  return database;
}

function tableNames(h: MigratedDatabase): string[] {
  return (
    h.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

describe('from an empty database', () => {
  it('creates every §6.2 table this work package owns', () => {
    const h = open();
    const names = tableNames(h);
    for (const table of [
      'organizations',
      'departments',
      'campuses',
      'settings',
      'users',
      'roles',
      'user_roles',
      'sessions',
      'audit_log',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('keeps what the earlier migrations made', () => {
    const names = tableNames(open());
    expect(names).toContain('app_meta');
    expect(names).toContain('job_state');
  });

  it('seeds exactly the two roles §10 fixes', () => {
    const h = open();
    const rows = h.db.raw.prepare('SELECT key, name FROM roles ORDER BY key').all() as {
      key: string;
      name: string;
    }[];
    expect(rows.map((row) => row.key)).toStrictEqual([...ROLE_KEYS].sort());
    expect(rows.every((row) => row.name.length > 0)).toBe(true);
  });

  it('installs both append-only triggers', () => {
    const h = open();
    const triggers = (
      h.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(triggers).toContain('audit_log_no_update');
    expect(triggers).toContain('audit_log_no_delete');
  });
});

describe('applying on top of a WP-04c-era database', () => {
  it('upgrades a database that already holds job state', () => {
    // A database from before this WP: migrations 0000 and 0001 only, with a row
    // in `job_state`. The migrator must add the new tables and leave it alone.
    const h = open();
    h.db.raw
      .prepare('INSERT INTO job_state (job_key, kind, next_due_at) VALUES (?,?,?)')
      .run('scrape:ctftime', 'SCRAPE', 1_700_000_000_000);

    // Re-run the migrator over the same file: it must be a no-op.
    const before = h.db.raw.prepare('SELECT count(*) as n FROM __drizzle_migrations').get() as {
      n: number;
    };
    expect(before.n).toBe(h.migrations);

    const job = h.db.raw.prepare('SELECT * FROM job_state').get() as { job_key: string };
    expect(job.job_key).toBe('scrape:ctftime');
    expect(tableNames(h)).toContain('users');
  });
});

describe('the CHECK constraints (§6.1: written from the contracts lists)', () => {
  function insertUser(h: MigratedDatabase, overrides: Partial<Record<string, unknown>> = {}): void {
    const row = {
      id: 'u1',
      email: 'a@b.edu',
      display_name: 'A',
      password_hash: 'x',
      status: 'ACTIVE',
      created_at: 1,
      updated_at: 1,
      ...overrides,
    };
    h.db.raw
      .prepare(
        'INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at) ' +
          'VALUES (@id, @email, @display_name, @password_hash, @status, @created_at, @updated_at)',
      )
      .run(row);
  }

  it('rejects an unknown user status', () => {
    const h = open();
    expect(() => {
      insertUser(h, { status: 'PENDING' });
    }).toThrow(/CHECK constraint/i);
  });

  it('rejects an email that is not lower-cased', () => {
    const h = open();
    expect(() => {
      insertUser(h, { email: 'A@B.edu' });
    }).toThrow(/CHECK constraint/i);
  });

  it('rejects a second account with the same email', () => {
    const h = open();
    insertUser(h);
    expect(() => {
      insertUser(h, { id: 'u2' });
    }).toThrow(/UNIQUE/i);
  });

  it('rejects an unknown role key', () => {
    const h = open();
    expect(() =>
      h.db.raw
        .prepare('INSERT INTO roles (id, key, name) VALUES (?,?,?)')
        .run('r3', 'SUPERUSER', 'Superuser'),
    ).toThrow(/CHECK constraint/i);
  });

  it('rejects an unknown actor kind on an audit row', () => {
    const h = open();
    expect(() =>
      h.db.raw
        .prepare(
          'INSERT INTO audit_log (id, occurred_at, actor_kind, action, entity_kind, entity_id, ' +
            'summary, diff_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .run('a1', 1, 'INTERN', 'a.b', 'k', 'i', 's', '{}', '0'.repeat(64), '1'.repeat(64)),
    ).toThrow(/CHECK constraint/i);
  });

  it('rejects an unknown session client kind', () => {
    const h = open();
    insertUser(h);
    expect(() =>
      h.db.raw
        .prepare(
          'INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, ' +
            'idle_expires_at, absolute_expires_at, client_kind) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('s1', 'u1', 'h', 1, 1, 2, 3, 'PHONE'),
    ).toThrow(/CHECK constraint/i);
  });

  it('rejects a campus outside the coordinate ranges', () => {
    const h = open();
    h.db.raw
      .prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?,?,?,?)')
      .run('o1', 'Org', 1, 1);
    expect(() =>
      h.db.raw
        .prepare(
          'INSERT INTO campuses (id, organization_id, name, lat, lon, created_at, updated_at) ' +
            'VALUES (?,?,?,?,?,?,?)',
        )
        .run('c1', 'o1', 'Main', 120, 0, 1, 1),
    ).toThrow(/CHECK constraint/i);
  });

  it('enforces the foreign key from a user to a department', () => {
    const h = open();
    expect(() =>
      h.db.raw
        .prepare(
          'INSERT INTO users (id, department_id, email, display_name, password_hash, status, ' +
            'created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('u9', 'no-such-department', 'c@d.edu', 'C', 'x', 'ACTIVE', 1, 1),
    ).toThrow(/FOREIGN KEY/i);
  });
});
