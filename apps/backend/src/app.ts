import { randomUUID } from 'node:crypto';

import type { HealthDatabase } from '@compintel/contracts';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import type { AuthService } from './modules/auth/service.js';
import { registerSetupGate } from './modules/setup/gate.js';
import type { SetupService } from './modules/setup/service.js';
import type { DedupReviewService } from './modules/events/review.js';
import type { EventImportService } from './modules/events/import/service.js';
import type { EventCategoriesService } from './modules/events/categories.js';
import type { EventDetailService } from './modules/events/detail.js';
import type { CategoryAdminService } from './modules/categories/admin.js';
import type { EventUserStateService } from './modules/events/user-state.js';
import type { SearchModule } from './modules/search/wiring.js';
import type { SourcesService } from './modules/sources/service.js';
import type { UsersService } from './modules/users/service.js';
import { registerAuthentication } from './platform/authn.js';
import type { Config } from './platform/config.js';
import { registerErrorHandling } from './platform/errors.js';
import { registerRequestLogging } from './platform/request-log.js';
import { registerSecurity } from './platform/security.js';
import { ShutdownRegistry } from './platform/shutdown.js';
import { StreamHub } from './platform/stream.js';
import { adminUsersRoutes } from './routes/admin-users.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { setupRoutes } from './routes/setup.js';
import { dedupRoutes } from './routes/dedup.js';
import { eventsRoutes } from './routes/events.js';
import { eventDetailRoutes } from './routes/event-detail.js';
import { userStateRoutes } from './routes/user-state.js';
import { categoryRoutes } from './routes/categories.js';
import { searchRoutes } from './routes/search.js';
import type { ConnectPromptService } from './modules/sources/connect-prompt.js';
import { sourcesRoutes } from './routes/sources.js';
import { streamRoutes } from './routes/stream.js';
import { systemRoutes } from './routes/system.js';
import { studentsRoutes } from './routes/students.js';
import { teamsRoutes } from './routes/teams.js';
import { competitionsRoutes } from './routes/competitions.js';
import { workflowTemplatesRoutes } from './routes/workflow-templates.js';
import type { StudentsModule } from './modules/students/wiring.js';
import type { TeamsModule } from './modules/teams/wiring.js';
import type { EngagementsModule } from './modules/engagements/wiring.js';
import type { WorkflowsModule } from './modules/workflows/wiring.js';
import { systemClock, type Clock } from './platform/time.js';

/** Request bodies larger than this are rejected before they are parsed. */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/** Every route lives under this prefix (ARCHITECTURE.md 4.4). */
export const API_PREFIX = '/api/v1';

/** What `/health` says when no database has been handed to `buildApp`. */
const NO_DATABASE: HealthDatabase = { ok: false, migrationsApplied: 0 };

export interface BuildAppOptions {
  /** Called once `POST /system/shutdown` has answered 202. */
  readonly onShutdownRequested?: () => void;
  /** Injected in tests so `uptimeSec` is deterministic. */
  readonly clock?: Clock;
  /** Injected in tests; defaults to the moment `buildApp` was called. */
  readonly startedAt?: Date;
  /** Read on every `/health` call, so it reflects the handle's current state. */
  readonly database?: () => HealthDatabase;
  /**
   * Shared with the caller so components opened before the HTTP layer - the
   * data-dir lock, the database - can register their teardown (ruling R14).
   */
  readonly shutdown?: ShutdownRegistry;
  /**
   * Resolved per request: the service is built after the database opens, and a
   * backend without one answers 401 on every route that needs a session.
   */
  readonly auth?: () => AuthService | undefined;
  /** Resolved per request for the same reason as `auth`; drives the R39 gate. */
  readonly setup?: () => SetupService | undefined;
  readonly users?: () => UsersService | undefined;
  /** Resolved per request; absent on a backend built without a database. */
  readonly sources?: () => SourcesService | undefined;
  /** R74's one-time "Connect your sources" step. */
  readonly connectPrompt?: () => ConnectPromptService | undefined;
  /** WP-10's duplicate review, conflicts and change history. */
  readonly review?: () => DedupReviewService | undefined;
  /** WP-14's manual entry and URL import. */
  readonly imports?: () => EventImportService | undefined;
  /** WP-15a's search, event detail and alias admin. */
  readonly search?: () => SearchModule | undefined;
  /** WP-15b's category and rule admin. */
  readonly categories?: () => CategoryAdminService | undefined;
  /** WP-16a's per-user Save and Hide. */
  readonly userState?: () => EventUserStateService | undefined;
  /** WP-16b's detail drawer: provenance, conflicts, deadlines, sources, history. */
  readonly eventDetail?: () => EventDetailService | undefined;
  /** WP-16b's per-event category override (D-15). */
  readonly eventCategories?: () => EventCategoriesService | undefined;
  /** WP-17's students, mentorships and import. */
  readonly students?: () => StudentsModule | undefined;
  /** WP-18's teams, members and mentors. */
  readonly teams?: () => TeamsModule | undefined;
  /** WP-19's competitions: status machine, roster, mentors, assign flow. */
  readonly competitions?: () => EngagementsModule | undefined;
  /** WP-20a's workflow templates and workflows. */
  readonly workflows?: () => WorkflowsModule | undefined;
  /** Shared so jobs and services can publish; one hub per process (R36). */
  readonly streamHub?: StreamHub;
  /** Injected in tests so a heartbeat does not take fifteen real seconds. */
  readonly streamHeartbeatMs?: number;
}

export interface App {
  readonly server: FastifyInstance;
  /** Where the database, the job runner and friends register their teardown. */
  readonly shutdown: ShutdownRegistry;
  /** The process-wide SSE hub; publish to it to reach every open client. */
  readonly streamHub: StreamHub;
  readonly startedAt: Date;
}

/**
 * Builds the HTTP application without listening and without waiting for boot, so
 * tests can add fixture routes before the instance is sealed. `main.ts` owns
 * binding, the READY line and the process lifecycle.
 */
export function buildApp(
  config: Config,
  logger: FastifyBaseLogger,
  options: BuildAppOptions = {},
): App {
  const clock = options.clock ?? systemClock;
  const startedAt = options.startedAt ?? clock.now();
  const database = options.database ?? ((): HealthDatabase => NO_DATABASE);

  const server = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: false,
    // Ruling R11: one onResponse line per request instead of Fastify's two.
    logController: new LogController({ disableRequestLogging: true }),
  });

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // Registration order is hook order: the request id must exist before any hook
  // can reject the request, and security must run before any route handler.
  registerErrorHandling(server);
  registerRequestLogging(server);
  registerSecurity(server, config);

  const auth = options.auth ?? ((): AuthService | undefined => undefined);
  const setup = options.setup ?? ((): SetupService | undefined => undefined);
  const users = options.users ?? ((): UsersService | undefined => undefined);
  const sources = options.sources ?? ((): SourcesService | undefined => undefined);
  const connectPrompt =
    options.connectPrompt ?? ((): ConnectPromptService | undefined => undefined);
  const review = options.review ?? ((): DedupReviewService | undefined => undefined);
  const imports = options.imports ?? ((): EventImportService | undefined => undefined);
  const search = options.search ?? ((): SearchModule | undefined => undefined);
  const categories = options.categories ?? ((): CategoryAdminService | undefined => undefined);
  const userState = options.userState ?? ((): EventUserStateService | undefined => undefined);

  // Order is hook order, and this order is the point: a request on a fresh
  // install is refused for being unconfigured (R39) before it is refused for
  // being unauthenticated, because "sign in" is not advice anyone can follow yet.
  registerSetupGate(server, { apiPrefix: API_PREFIX, setup });
  registerAuthentication(server, {
    apiPrefix: API_PREFIX,
    auth,
    setupRequired: () => setup()?.isRequired() ?? false,
  });

  const shutdown = options.shutdown ?? new ShutdownRegistry();
  const streamHub = options.streamHub ?? new StreamHub();
  // Ruling R14/R36: open streams are ended before `server.close()` runs, which
  // would otherwise sit waiting for responses that never end by themselves.
  shutdown.register('streams', 'sse-hub', () => {
    streamHub.closeAll();
  });

  const onShutdownRequested = options.onShutdownRequested ?? ((): void => undefined);
  void server.register(healthRoutes({ config, startedAt, clock, database }), {
    prefix: API_PREFIX,
  });
  void server.register(systemRoutes({ onShutdownRequested }), { prefix: API_PREFIX });
  void server.register(authRoutes({ auth }), { prefix: API_PREFIX });
  void server.register(meRoutes({ auth }), { prefix: API_PREFIX });
  void server.register(setupRoutes({ setup }), { prefix: API_PREFIX });
  void server.register(adminUsersRoutes({ users }), { prefix: API_PREFIX });
  void server.register(sourcesRoutes({ sources, connectPrompt }), { prefix: API_PREFIX });
  void server.register(dedupRoutes({ review }), { prefix: API_PREFIX });
  void server.register(eventsRoutes({ imports }), { prefix: API_PREFIX });
  void server.register(searchRoutes({ search }), { prefix: API_PREFIX });
  void server.register(categoryRoutes({ categories }), { prefix: API_PREFIX });
  void server.register(userStateRoutes({ userState }), { prefix: API_PREFIX });
  void server.register(studentsRoutes({ students: options.students ?? (() => undefined) }), {
    prefix: API_PREFIX,
  });
  void server.register(teamsRoutes({ teams: options.teams ?? (() => undefined) }), {
    prefix: API_PREFIX,
  });
  void server.register(
    competitionsRoutes({ competitions: options.competitions ?? (() => undefined) }),
    { prefix: API_PREFIX },
  );
  void server.register(
    workflowTemplatesRoutes({ workflows: options.workflows ?? (() => undefined) }),
    { prefix: API_PREFIX },
  );
  void server.register(
    eventDetailRoutes({
      detail: options.eventDetail ?? ((): EventDetailService | undefined => undefined),
      categories: options.eventCategories ?? ((): EventCategoriesService | undefined => undefined),
    }),
    { prefix: API_PREFIX },
  );
  void server.register(
    streamRoutes({
      hub: streamHub,
      ...(options.streamHeartbeatMs === undefined
        ? {}
        : { heartbeatMs: options.streamHeartbeatMs }),
    }),
    { prefix: API_PREFIX },
  );

  return { server, shutdown, streamHub, startedAt };
}
