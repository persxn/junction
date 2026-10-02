import { afterEach, describe, expect, it } from 'vitest';

import { verifyPassword } from '../modules/auth/password.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { DEMO_PROFESSOR_EMAIL, seedDemoStudentsInto } from './students-demo-seed.js';
import { openStudentsHarness, type StudentsHarness } from './students.js';

/** `pnpm seed:demo --students` (WP-17 step 7), against a real migrated database. */

let harness: StudentsHarness | undefined;
let bare: MigratedDatabase | undefined;
afterEach(() => {
  harness?.close();
  bare?.close();
  harness = undefined;
  bare = undefined;
});

describe('seedDemoStudentsInto', () => {
  it('adds the 60 synthetic students, mentored by a demo professor nobody can sign in as', async () => {
    harness = openStudentsHarness();
    const { db } = harness.database;
    const seeded = seedDemoStudentsInto(db);
    expect(seeded.students).toBe(60);

    const count = db.raw.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number };
    expect(count.n).toBe(60);
    const open = db.raw
      .prepare(
        'SELECT COUNT(*) AS n FROM mentorships WHERE mentor_user_id = ? AND ended_at IS NULL',
      )
      .get(seeded.professorId) as { n: number };
    expect(open.n).toBe(60);
    // D-33: every address is synthetic.
    const real = db.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM students WHERE institutional_email NOT LIKE '%@example.edu'",
      )
      .get() as { n: number };
    expect(real.n).toBe(0);

    const professor = db.raw
      .prepare('SELECT password_hash AS hash FROM users WHERE email = ?')
      .get(DEMO_PROFESSOR_EMAIL) as { hash: string };
    expect(await verifyPassword(professor.hash, '')).toBe(false);
    expect(await verifyPassword(professor.hash, 'seed-demo:no-password')).toBe(false);
  });

  it('refuses a database that already holds students', () => {
    harness = openStudentsHarness();
    seedDemoStudentsInto(harness.database.db);
    expect(() => seedDemoStudentsInto(harness!.database.db)).toThrow(/already holds 60 students/);
  });

  it('refuses a database that has not been through setup', () => {
    bare = openMigratedDatabase();
    expect(() => seedDemoStudentsInto(bare!.db)).toThrow(/not been through setup/);
  });
});
