import type { RoleKey } from '@compintel/contracts';

import { departments, organizations } from '../db/schema/index.js';
import { AuthRepository } from '../modules/auth/repository.js';
import type { AuthService } from '../modules/auth/service.js';
import type { ActiveSession, Principal } from '../modules/auth/types.js';
import type { StudentsContext } from '../modules/students/mappers.js';
import { createStudentsModule, type StudentsModule } from '../modules/students/wiring.js';
import { createTeamsModule, type TeamsModule } from '../modules/teams/wiring.js';
import { createEngagementsModule, type EngagementsModule } from '../modules/engagements/wiring.js';
import { createWorkflowsModule, type WorkflowsModule } from '../modules/workflows/wiring.js';
import { createResourcesModule, type ResourcesModule } from '../modules/resources/wiring.js';
import {
  createOutcomeLookup,
  createOutcomesModule,
  type OutcomesModule,
} from '../modules/outcomes/wiring.js';
import { createTransferModule, type TransferModule } from '../modules/transfer/wiring.js';
import { createDeadlinesModule, type DeadlinesModule } from '../modules/deadlines/wiring.js';
import { AuditLog } from '../platform/audit.js';
import { sessionExpired } from '../modules/auth/errors.js';
import { uuid7 } from '../platform/ids.js';
import { SettingsStore } from '../platform/settings.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { startTestServer, type TestServer } from './harness.js';
import { silentLogger } from './scraping.js';

/**
 * Students on a real migrated database, with no password hashing anywhere
 * (WP-17).
 *
 * The accounts are inserted with a placeholder hash and are never signed in:
 * a test acts as one by building a context, and the HTTP server maps a bearer
 * token straight to that principal. Signing in costs an Argon2id hash at R17's
 * production cost, and R89 keeps those out of tests that are not about signing
 * in.
 */

export interface StudentsHarness {
  readonly database: MigratedDatabase;
  readonly module: StudentsModule;
  /** WP-18: teams over the same database. */
  readonly teams: TeamsModule;
  /** WP-19: competitions over the same database. */
  readonly competitions: EngagementsModule;
  /** WP-20a: workflow templates (seeded) and workflows. */
  readonly workflows: WorkflowsModule;
  /** WP-20b: resources. */
  readonly resources: ResourcesModule;
  /** WP-21: outcomes. */
  readonly outcomes: OutcomesModule;
  /** WP-21: ownership transfer. */
  readonly transfer: TransferModule;
  /** WP-22: deadlines. */
  readonly deadlines: DeadlinesModule;
  readonly audit: AuditLog;
  readonly settings: SettingsStore;
  readonly clock: { now: () => Date; advance(ms: number): void };
  readonly organizationId: string;
  /** CSE, the managing department. */
  readonly departmentId: string;
  /** ECE, a reference department. */
  readonly otherDepartmentId: string;
  readonly admin: Principal;
  readonly alice: Principal;
  readonly bob: Principal;
  context(actor: Principal): StudentsContext;
  user(name: string, roles: readonly RoleKey[]): Principal;
  close(): void;
}

export function openStudentsHarness(startIso = '2026-10-01T04:30:00.000Z'): StudentsHarness {
  const database = openMigratedDatabase(silentLogger, 'students');
  let at = Date.parse(startIso);
  const clock = {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
  const { db } = database;
  const organizationId = uuid7();
  db.drizzle
    .insert(organizations)
    .values({ id: organizationId, name: 'Example Institute', createdAt: at, updatedAt: at })
    .run();
  const departmentId = uuid7();
  const otherDepartmentId = uuid7();
  db.drizzle
    .insert(departments)
    .values([
      {
        id: departmentId,
        organizationId,
        name: 'Computer Science and Engineering',
        code: 'CSE',
        isManaging: true,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: otherDepartmentId,
        organizationId,
        name: 'Electronics and Communication',
        code: 'ECE',
        isManaging: false,
        createdAt: at,
        updatedAt: at,
      },
    ])
    .run();

  const auth = new AuthRepository(db, { clock });
  const user = (name: string, roles: readonly RoleKey[]): Principal => {
    const row = auth.createUser({
      email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.edu`,
      displayName: name,
      passwordHash: 'not-a-real-hash',
      roles,
    });
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      departmentId: null,
      status: 'ACTIVE',
      mustChangePassword: false,
      roles: [...roles],
    };
  };
  const audit = new AuditLog(db, { clock });
  const settings = new SettingsStore(db, { clock });
  const module = createStudentsModule({ db, audit, settings, clock });
  const teams = createTeamsModule({ db, audit, clock });
  const workflows = createWorkflowsModule({ db, audit, clock });
  workflows.templatesRepository.ensureSeeded(at);
  const resources = createResourcesModule({ db, audit, clock });
  const outcomes = createOutcomeLookup(db, resources);
  const competitions = createEngagementsModule({
    db,
    audit,
    clock,
    onAssigned: [workflows.copier.onAssigned],
    summaries: (rows) => workflows.reader.summaries(rows),
    outcomes: outcomes.lookup,
  });
  return {
    database,
    module,
    teams,
    competitions,
    workflows,
    resources,
    outcomes: createOutcomesModule({
      repository: outcomes.repository,
      competitions,
      resources,
      audit,
      clock,
    }),
    transfer: createTransferModule({ db, audit, clock }),
    deadlines: createDeadlinesModule({ db, clock }),
    audit,
    settings,
    clock,
    organizationId,
    departmentId,
    otherDepartmentId,
    admin: user('Asha Admin', ['ADMINISTRATOR']),
    alice: user('Alice Professor', ['PROFESSOR']),
    bob: user('Bob Professor', ['PROFESSOR']),
    context: (actor) => ({ actor, requestId: 'test-request' }),
    user,
    close: () => {
      database.close();
    },
  };
}

/** A bearer token per principal, for the HTTP tests: the token is the user's id. */
export function principalAuth(principals: readonly Principal[]): () => AuthService {
  const byId = new Map(principals.map((principal) => [principal.id, principal]));
  const service = {
    authenticate: (token: string): ActiveSession => {
      const user = byId.get(token);
      if (user === undefined) throw sessionExpired('Not one of the test principals.');
      return {
        id: `session-${user.id}`,
        user,
        idleExpiresAt: Number.MAX_SAFE_INTEGER,
        absoluteExpiresAt: Number.MAX_SAFE_INTEGER,
      };
    },
  };
  return () => service as unknown as AuthService;
}

export async function startStudentsServer(
  h: StudentsHarness,
  extra: readonly Principal[] = [],
): Promise<TestServer> {
  return startTestServer({
    auth: principalAuth([h.admin, h.alice, h.bob, ...extra]),
    students: () => h.module,
    teams: () => h.teams,
    competitions: () => h.competitions,
    workflows: () => h.workflows,
    resources: () => h.resources,
    outcomes: () => h.outcomes,
    transfer: () => h.transfer,
    deadlines: () => h.deadlines,
  });
}

/** One JSON request to the test server as a principal. */
export async function call(
  server: TestServer,
  method: string,
  route: string,
  options: { as?: Principal; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${server.baseUrl}${route}`, {
    method,
    headers: {
      'X-CompIntel-Client': server.config.clientSecret,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.as === undefined ? {} : { Authorization: `Bearer ${options.as.id}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as never) };
}
