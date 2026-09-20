import { HealthResponse, type HealthDatabase } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { Config } from '../platform/config.js';

export interface HealthRouteOptions {
  readonly config: Config;
  /** When this process finished starting; fixed for the life of the process. */
  readonly startedAt: Date;
  /** Injected in tests so `uptimeSec` is deterministic. */
  readonly now: () => Date;
  /** Current database state; read per request, never cached. */
  readonly database: () => HealthDatabase;
}

/**
 * `GET /health` - the liveness probe the shell polls. It needs the client secret
 * but never a session (ADR-0017), so it works before login. Completion of this
 * route is logged at debug, not info (ruling R11).
 */
export const healthRoutes =
  (options: HealthRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/health', { schema: { response: { 200: HealthResponse } } }, () => {
      const elapsedMs = options.now().getTime() - options.startedAt.getTime();
      return {
        status: 'ok' as const,
        appVersion: options.config.appVersion,
        apiVersion: options.config.apiVersion,
        startedAt: options.startedAt.toISOString(),
        uptimeSec: Math.max(0, Math.floor(elapsedMs / 1000)),
        database: options.database(),
      };
    });
    done();
  };
