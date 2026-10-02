import { AuthRepository } from '../modules/auth/repository.js';
import type { Principal } from '../modules/auth/types.js';
import { createStudentsModule } from '../modules/students/wiring.js';
import { createTeamsModule } from '../modules/teams/wiring.js';
import { AuditLog } from '../platform/audit.js';
import type { DatabaseHandle } from '../platform/db.js';
import { SettingsStore } from '../platform/settings.js';
import { seedDemoStudents } from './students-demo.js';
import { seedDemoTeams } from './teams-demo.js';

/**
 * `pnpm seed:demo --students` (WP-17 step 7): the 60 synthetic students, on a
 * dev database that has already been through setup — students belong to the
 * organization setup creates (R91), so there is nothing to attach them to
 * before it.
 *
 * WP-18 adds 12 teams over them (`teams-demo.ts`), with a demo co-mentor.
 *
 * They are mentored by a demo professor created here with a placeholder in
 * place of a password hash: no password verifies against it, so the account
 * exists to own mentorships and can never be signed in to.
 */

export const DEMO_PROFESSOR_EMAIL = 'demo.professor@example.edu';
export const DEMO_CO_MENTOR_EMAIL = 'demo.co-mentor@example.edu';

export interface DemoStudentsSeed {
  readonly students: number;
  /** WP-18: 12 teams over them. */
  readonly teams: number;
  readonly professorId: string;
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
  const audit = new AuditLog(db);
  const module = createStudentsModule({ db, audit, settings: new SettingsStore(db) });
  const students = seedDemoStudents(module, professor);
  const ids = (
    db.raw.prepare('SELECT id FROM students ORDER BY university_id_key').all() as { id: string }[]
  ).map((student) => student.id);
  const teams = seedDemoTeams(createTeamsModule({ db, audit }), ids, professor, coMentor);
  return { students, teams, professorId: professor.id };
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
