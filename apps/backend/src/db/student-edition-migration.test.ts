import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureDataDirs, loadConfig } from '../platform/config.js';
import { openDatabase, type DatabaseHandle } from '../platform/db.js';
import { runMigrations } from '../platform/migrate.js';
import { migrationsDir } from '../testing/database.js';
import { makeTempDir, removeDirectory } from '../testing/temp.js';

/**
 * Migration 0033 (WP-34) rebuilds `roles` and `students`, which other tables
 * point at, inside drizzle's single transaction. Proven on a v0.9.1-shaped
 * database that already holds a student in a team, a mentorship and a role
 * grant: nothing is lost and no foreign key is left dangling.
 */

const logger = pino({ enabled: false });
const T = 1_790_000_000_000;
const ID = (n: number): string => `01926b00-0000-7000-8000-${n.toString().padStart(12, '0')}`;

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** A migrations folder holding everything up to and including `lastTag`. */
function migrationsUpTo(root: string, lastTag: string): string {
  const dir = path.join(root, 'migrations-partial');
  cpSync(migrationsDir(), dir, { recursive: true });
  const journalFile = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalFile, JSON.stringify(journal));
  return dir;
}

function seedPeople(db: DatabaseHandle): void {
  const run = (sql: string, ...values: unknown[]): void => {
    db.raw.prepare(sql).run(...values);
  };
  run(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, 'Org', ?, ?)`,
    ID(10),
    T,
    T,
  );
  run(
    `INSERT INTO departments (id, organization_id, name, is_managing, created_at, updated_at) VALUES (?, ?, 'CSE', 1, ?, ?)`,
    ID(11),
    ID(10),
    T,
    T,
  );
  run(
    `INSERT INTO users (id, department_id, email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, 'prof@example.edu', 'Prof', 'x', ?, ?)`,
    ID(20),
    ID(11),
    T,
    T,
  );
  run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (?, ?, ?)`, ID(20), ID(2), T);
  run(
    `INSERT INTO students (id, organization_id, university_id, university_id_key, full_name, home_department_id, program, created_at, updated_at) VALUES (?, ?, '21 cs 01', '21CS01', 'Asha', ?, 'BTECH', ?, ?)`,
    ID(30),
    ID(10),
    ID(11),
    T,
    T,
  );
  run(
    `INSERT INTO teams (id, department_id, name, name_key, created_at, updated_at) VALUES (?, ?, 'Alpha', 'alpha', ?, ?)`,
    ID(40),
    ID(11),
    T,
    T,
  );
  run(
    `INSERT INTO team_members (id, team_id, student_id, joined_at) VALUES (?, ?, ?, ?)`,
    ID(41),
    ID(40),
    ID(30),
    T,
  );
  run(
    `INSERT INTO mentorships (id, mentor_user_id, student_id, started_at) VALUES (?, ?, ?, ?)`,
    ID(50),
    ID(20),
    ID(30),
    T,
  );
}

const count = (db: DatabaseHandle, table: string): number =>
  (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('migration 0033 (student edition)', () => {
  it('rebuilds roles and students under live references without losing a row', () => {
    const root = makeTempDir('student-edition');
    const config = loadConfig({
      argv: ['--data-dir', root],
      env: { COMPINTEL_CLIENT_SECRET: '0123456789abcdef0123456789abcdef' },
    });
    ensureDataDirs(config);
    const db = openDatabase(config, { logger });
    cleanup = () => {
      db.close();
      removeDirectory(root);
    };

    runMigrations(config, db, {
      migrationsDir: migrationsUpTo(root, '0032_fresh_install_repairs'),
      logger,
    });
    seedPeople(db);
    const before = ['students', 'team_members', 'mentorships', 'user_roles', 'roles'].map((table) =>
      count(db, table),
    );

    runMigrations(config, db, { migrationsDir: migrationsDir(), logger });

    expect(
      ['students', 'team_members', 'mentorships', 'user_roles', 'roles'].map((table) =>
        count(db, table),
      ),
    ).toStrictEqual([before[0], before[1], before[2], before[3], (before[4] ?? 0) + 1]);
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toStrictEqual([]);
    expect(db.raw.prepare('SELECT university_id_key FROM students').get()).toStrictEqual({
      university_id_key: '21CS01',
    });
    expect(db.raw.prepare(`SELECT key FROM roles ORDER BY key`).all()).toStrictEqual([
      { key: 'ADMINISTRATOR' },
      { key: 'PROFESSOR' },
      { key: 'STUDENT' },
    ]);
    // The deadline view still reads through the rebuilt table.
    expect(() => db.raw.prepare('SELECT count(*) FROM v_deadlines').get()).not.toThrow();

    // Two students with no roll number can coexist; a duplicate roll number cannot.
    const insert = db.raw.prepare(
      `INSERT INTO students (id, organization_id, university_id, university_id_key, full_name, home_department_id, program, created_at, updated_at) VALUES (?, ?, ?, ?, 'X', ?, 'OTHER', ?, ?)`,
    );
    insert.run(ID(31), ID(10), null, null, ID(11), T, T);
    insert.run(ID(32), ID(10), null, null, ID(11), T, T);
    expect(() => insert.run(ID(33), ID(10), '21cs01', '21CS01', ID(11), T, T)).toThrow(/UNIQUE/);
  });
});
