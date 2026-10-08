import { AuthRepository } from '../modules/auth/repository.js';
import type { Principal } from '../modules/auth/types.js';
import { createStudentsModule } from '../modules/students/wiring.js';
import { createEngagementsModule } from '../modules/engagements/wiring.js';
import { createOutcomeLookup, createOutcomesModule } from '../modules/outcomes/wiring.js';
import { createResourcesModule } from '../modules/resources/wiring.js';
import { createTeamsModule } from '../modules/teams/wiring.js';
import { createWorkflowsModule } from '../modules/workflows/wiring.js';
import { seedDemoCompetitions } from './competitions-demo.js';
import { AuditLog } from '../platform/audit.js';
import type { DatabaseHandle } from '../platform/db.js';
import { SettingsStore } from '../platform/settings.js';
import { seedDemoStudents } from './students-demo.js';
import { seedDemoTeams } from './teams-demo.js';
import { seedDemoDeadlines } from './deadlines-demo.js';
import { seedDemoOutcomes } from './outcomes-demo.js';
import { shapeDemoWorkflows } from './workflows-demo.js';

/**
 * `pnpm seed:demo --students` (WP-17 step 7): the 60 synthetic students, on a
 * dev database that has already been through setup — students belong to the
 * organization setup creates (R91), so there is nothing to attach them to
 * before it.
 *
 * WP-18 adds 12 teams over them (`teams-demo.ts`), with a demo co-mentor.
 * WP-20a copies a workflow into every competition that reaches ASSIGNED, and
 * shapes five open ones into the five schedule healths (`workflows-demo.ts`).
 * WP-21 records outcomes on the COMPLETED ones and adds a second professor to
 * transfer ownership to (`outcomes-demo.ts`).
 *
 * They are mentored by a demo professor created here with a placeholder in
 * place of a password hash: no password verifies against it, so the account
 * exists to own mentorships and can never be signed in to.
 */

export const DEMO_PROFESSOR_EMAIL = 'demo.professor@example.edu';
export const DEMO_CO_MENTOR_EMAIL = 'demo.co-mentor@example.edu';
/** WP-21: the professor an ownership transfer can move things to. */
export const DEMO_SECOND_PROFESSOR_EMAIL = 'demo.second-professor@example.edu';

export interface DemoStudentsSeed {
  readonly students: number;
  /** WP-18: 12 teams over them. */
  readonly teams: number;
  /** WP-19: 20 competitions over the teams, students and events (none without events). */
  readonly competitions: number;
  /** WP-20a: open competitions whose workflow was shaped into one of the five healths. */
  readonly shapedWorkflows: number;
  /** WP-21: outcomes recorded on the COMPLETED demo competitions. */
  readonly outcomes: number;
  /** WP-22: stage and task dates in every bucket, event deadlines in every precision. */
  readonly deadlines: { stages: number; tasks: number; eventDeadlines: number };
  readonly professorId: string;
  readonly secondProfessorId: string;
}

export function seedDemoStudentsInto(db: DatabaseHandle): DemoStudentsSeed {
  const organizations = db.raw.prepare('SELECT COUNT(*) AS n FROM organizations').get() as {
    n: number;
  };
  if (organizations.n === 0) {
    throw new Error('this database has not been through setup yet; finish the setup wizard first');
  }
  const existing = db.raw.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number };
  if (existing.n > 0) {
    throw new Error(`this database already holds ${String(existing.n)} students; use a fresh one`);
  }
  const auth = new AuthRepository(db);
  const professor = demoProfessor(auth, DEMO_PROFESSOR_EMAIL, 'Demo Professor');
  const coMentor = demoProfessor(auth, DEMO_CO_MENTOR_EMAIL, 'Demo Co-mentor');
  const second = demoProfessor(auth, DEMO_SECOND_PROFESSOR_EMAIL, 'Demo Second Professor');
  const audit = new AuditLog(db);
  const module = createStudentsModule({ db, audit, settings: new SettingsStore(db) });
  const students = seedDemoStudents(module, professor);
  const ids = (
    db.raw.prepare('SELECT id FROM students ORDER BY university_id_key').all() as { id: string }[]
  ).map((student) => student.id);
  const teams = seedDemoTeams(createTeamsModule({ db, audit }), ids, professor, coMentor);
  const teamIds = (
    db.raw.prepare('SELECT id FROM teams ORDER BY name_key').all() as { id: string }[]
  ).map((team) => team.id);
  const loneStudentIds = (
    db.raw
      .prepare(
        `SELECT s.id FROM students s WHERE s.status = 'ACTIVE' AND NOT EXISTS
           (SELECT 1 FROM team_members m WHERE m.student_id = s.id AND m.left_at IS NULL)
         ORDER BY s.university_id_key`,
      )
      .all() as { id: string }[]
  ).map((student) => student.id);
  const eventIds = (
    db.raw
      .prepare(
        `SELECT id FROM events WHERE visibility = 'VISIBLE' AND cancellation = 'NONE'
         ORDER BY coalesce(registration_deadline_at, starts_at, 0) DESC, id LIMIT 20`,
      )
      .all() as { id: string }[]
  ).map((event) => event.id);
  const workflows = createWorkflowsModule({ db, audit });
  workflows.templatesRepository.ensureSeeded(Date.now());
  const resources = createResourcesModule({ db, audit });
  const lookup = createOutcomeLookup(db, resources);
  const engagements = createEngagementsModule({
    db,
    audit,
    onAssigned: [workflows.copier.onAssigned],
    outcomes: lookup.lookup,
  });
  const competitions = seedDemoCompetitions(engagements, {
    teamIds,
    loneStudentIds,
    eventIds,
    professor,
  });
  const open = (
    db.raw
      .prepare(
        `SELECT id FROM engagements WHERE status IN ('ASSIGNED', 'APPLIED', 'PARTICIPATING')
         ORDER BY created_at, id`,
      )
      .all() as { id: string }[]
  ).map((row) => row.id);
  const shapedWorkflows = shapeDemoWorkflows(workflows, open, professor, Date.now());
  const completed = (
    db.raw
      .prepare("SELECT id FROM engagements WHERE status = 'COMPLETED' ORDER BY created_at, id")
      .all() as { id: string }[]
  ).map((row) => row.id);
  const outcomes = seedDemoOutcomes(
    createOutcomesModule({
      repository: lookup.repository,
      competitions: engagements,
      resources,
      audit,
    }),
    completed,
    professor,
  );
  const deadlines = seedDemoDeadlines({
    db,
    workflows,
    // The first five carry the five healths; the rest get one date per bucket.
    competitionIds: open.slice(5),
    eventIds: eventIds.slice(-4),
    professor,
    now: Date.now(),
  });
  return {
    students,
    teams,
    competitions,
    shapedWorkflows,
    outcomes,
    deadlines,
    professorId: professor.id,
    secondProfessorId: second.id,
  };
}

/** A professor nobody can sign in as: no password verifies against the placeholder. */
function demoProfessor(auth: AuthRepository, email: string, displayName: string): Principal {
  const row = auth.createUser({
    email,
    displayName,
    passwordHash: 'seed-demo:no-password',
    roles: ['PROFESSOR'],
  });
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    departmentId: null,
    status: 'ACTIVE',
    mustChangePassword: false,
    roles: ['PROFESSOR'],
  };
}
