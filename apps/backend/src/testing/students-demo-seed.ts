import { AuthRepository } from '../modules/auth/repository.js';
import type { Principal } from '../modules/auth/types.js';
import { createStudentsModule } from '../modules/students/wiring.js';
import { AuditLog } from '../platform/audit.js';
import type { DatabaseHandle } from '../platform/db.js';
import { SettingsStore } from '../platform/settings.js';
import { seedDemoStudents } from './students-demo.js';

/**
 * `pnpm seed:demo --students` (WP-17 step 7): the 60 synthetic students, on a
 * dev database that has already been through setup — students belong to the
 * organization setup creates (R91), so there is nothing to attach them to
 * before it.
 *
 * They are mentored by a demo professor created here with a placeholder in
 * place of a password hash: no password verifies against it, so the account
 * exists to own mentorships and can never be signed in to.
 */

export const DEMO_PROFESSOR_EMAIL = 'demo.professor@example.edu';

export interface DemoStudentsSeed {
  readonly students: number;
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
  const row = new AuthRepository(db).createUser({
    email: DEMO_PROFESSOR_EMAIL,
    displayName: 'Demo Professor',
    passwordHash: 'seed-demo:no-password',
    roles: ['PROFESSOR'],
  });
  const professor: Principal = {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    departmentId: null,
    status: 'ACTIVE',
    mustChangePassword: false,
    roles: ['PROFESSOR'],
  };
  const module = createStudentsModule({
    db,
    audit: new AuditLog(db),
    settings: new SettingsStore(db),
  });
  return { students: seedDemoStudents(module, professor), professorId: row.id };
}
