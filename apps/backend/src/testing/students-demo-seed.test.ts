import type { EngagementStatus } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyPassword } from '../modules/auth/password.js';
import { createWorkflowsModule } from '../modules/workflows/wiring.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { makeEvent } from './competitions.js';
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

  it('adds 12 teams: one student in three, co-mentors, and all three coverage states (WP-18)', () => {
    harness = openStudentsHarness();
    const { db } = harness.database;
    const seeded = seedDemoStudentsInto(db);
    expect(seeded.teams).toBe(12);
    const shared = db.raw
      .prepare(
        `SELECT max(n) AS n FROM (SELECT count(*) AS n FROM team_members WHERE left_at IS NULL GROUP BY student_id)`,
      )
      .get() as { n: number };
    expect(shared.n).toBe(3);
    const coMentors = db.raw
      .prepare("SELECT count(*) AS n FROM team_mentors WHERE role = 'CO_MENTOR' AND to_at IS NULL")
      .get() as { n: number };
    expect(coMentors.n).toBe(6);
    const professor = { ...harness.alice, id: seeded.professorId };
    const list = harness.teams.records.list({ actor: professor }, {});
    const totals = list.items.reduce(
      (sum, team) => ({
        covered: sum.covered + team.coverage.covered,
        thin: sum.thin + team.coverage.thin,
        missing: sum.missing + team.coverage.missing,
      }),
      { covered: 0, thin: 0, missing: 0 },
    );
    expect(totals.covered).toBeGreaterThan(0);
    expect(totals.thin).toBeGreaterThan(0);
    expect(totals.missing).toBe(12);
  });

  it('adds 20 competitions with every status, once events exist (WP-19)', () => {
    harness = openStudentsHarness();
    const h = harness;
    for (let n = 0; n < 12; n += 1) makeEvent(h);
    const seeded = seedDemoStudentsInto(h.database.db);
    expect(seeded.competitions).toBe(20);
    const statuses = h.database.db.raw
      .prepare('SELECT DISTINCT status FROM engagements ORDER BY status')
      .all() as { status: string }[];
    expect(statuses.map((row) => row.status)).toEqual([
      'APPLIED',
      'ASSIGNED',
      'COMPLETED',
      'CONSIDERING',
      'NOT_SELECTED',
      'PARTICIPATING',
      'WITHDRAWN',
    ]);
    const kinds = h.database.db.raw
      .prepare('SELECT participant_kind AS kind, count(*) AS n FROM engagements GROUP BY kind')
      .all() as { kind: string; n: number }[];
    expect(kinds).toEqual([
      { kind: 'INDIVIDUAL', n: 8 },
      { kind: 'TEAM', n: 12 },
    ]);
  });

  it('copies a workflow into every assigned competition and shows all five healths (WP-20a)', () => {
    harness = openStudentsHarness();
    const h = harness;
    for (let n = 0; n < 12; n += 1) makeEvent(h);
    const seeded = seedDemoStudentsInto(h.database.db);
    expect(seeded.shapedWorkflows).toBe(5);
    const missing = h.database.db.raw
      .prepare(
        `SELECT count(*) AS n FROM engagements e WHERE e.status <> 'CONSIDERING'
           AND NOT EXISTS (SELECT 1 FROM workflows w WHERE w.engagement_id = e.id)`,
      )
      .get() as { n: number };
    expect(missing.n).toBe(0);
    const rows = h.database.db.raw.prepare('SELECT id, status FROM engagements').all() as {
      id: string;
      status: EngagementStatus;
    }[];
    // The seed dates stages from the real clock, so read them with it.
    const reader = createWorkflowsModule({ db: h.database.db, audit: h.audit }).reader;
    const healths = new Set([...reader.summaries(rows).values()].map((row) => row.health));
    expect([...healths].filter((health) => health !== null).sort()).toEqual([
      'AT_RISK',
      'BLOCKED',
      'NO_DATES',
      'ON_TRACK',
      'OVERDUE',
    ]);
  });

  it('adds no competitions to a database without events', () => {
    harness = openStudentsHarness();
    expect(seedDemoStudentsInto(harness.database.db).competitions).toBe(0);
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
