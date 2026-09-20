import { randomUUID } from 'node:crypto';

import type { HealthDatabase } from '@compintel/contracts';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import type { Config } from './platform/config.js';
import { registerErrorHandling } from './platform/errors.js';
import { registerRequestLogging } from './platform/request-log.js';
import { registerSecurity } from './platform/security.js';
import { ShutdownRegistry } from './platform/shutdown.js';
import { healthRoutes } from './routes/health.js';
import { systemRoutes } from './routes/system.js';

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
  readonly now?: () => Date;
  /** Injected in tests; defaults to the moment `buildApp` was called. */
  readonly startedAt?: Date;
  /** Read on every `/health` call, so it reflects the handle's current state. */
  readonly database?: () => HealthDatabase;
  /**
   * Shared with the caller so components opened before the HTTP layer - the
   * data-dir lock, the database - can register their teardown (ruling R14).
   */
  readonly shutdown?: ShutdownRegistry;
}

export interface App {
  readonly server: FastifyInstance;
  /** Where the database, the job runner and friends register their teardown. */
  readonly shutdown: ShutdownRegistry;
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
  const startedAt = options.startedAt ?? new Date();
  const now = options.now ?? ((): Date => new Date());
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

  const onShutdownRequested = options.onShutdownRequested ?? ((): void => undefined);
  void server.register(healthRoutes({ config, startedAt, now, database }), { prefix: API_PREFIX });
  void server.register(systemRoutes({ onShutdownRequested }), { prefix: API_PREFIX });

  return { server, shutdown: options.shutdown ?? new ShutdownRegistry(), startedAt };
}
