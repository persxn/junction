import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../platform/errors.js';
import { LoginRateLimiter } from '../modules/auth/throttle.js';

/** Body of `POST /system/shutdown`; the work happens after the response is sent. */
export const ShutdownAccepted = z.object({
  accepted: z.literal(true),
});
export type ShutdownAccepted = z.infer<typeof ShutdownAccepted>;

/** Ruling A19: the client log is capped at 8 KB and 30 requests a minute. */
export const CLIENT_LOG_MAX_BYTES = 8 * 1024;
export const CLIENT_LOG_RATE_LIMIT = 30;

export const CLIENT_LOG_LEVELS = ['error', 'warn', 'info'] as const;

export const ClientLogRequest = z.object({
  level: z.enum(CLIENT_LOG_LEVELS).default('error'),
  /** One line; the UI does not get to write an essay into the backend log. */
  message: z.string().min(1).max(2_000),
  /** Free-form context. Redaction (`platform/redact.ts`) still applies to it. */
  context: z.record(z.string(), z.unknown()).optional(),
});
export type ClientLogRequest = z.infer<typeof ClientLogRequest>;

export const ClientLogAccepted = z.object({ accepted: z.literal(true) });
export type ClientLogAccepted = z.infer<typeof ClientLogAccepted>;

export interface SystemRouteOptions {
  /** Starts the graceful shutdown. Called once, after the 202 has been flushed. */
  readonly onShutdownRequested: () => void;
  /** Injected in tests; defaults to A19's 30 requests a minute. */
  readonly clientLogLimiter?: LoginRateLimiter;
}

/**
 * `/system/*`.
 *
 * `POST /system/shutdown` is the shell's "Exit completely" path (§3.2). In host
 * mode the client secret is the only gate, because it must work before anyone
 * has signed in and whoever holds the per-spawn secret is the shell we started.
 * In server mode (LAN) it needs an authenticated admin session; that is flagged
 * in the WP-07a report.
 *
 * `POST /system/client-log` is ruling A19: the client secret, no session, a
 * small body and a hard rate limit, so a broken render loop cannot fill the disk.
 */
export const systemRoutes =
  (options: SystemRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const limiter =
      options.clientLogLimiter ??
      new LoginRateLimiter({ limit: CLIENT_LOG_RATE_LIMIT, windowMs: 60_000 });

    app.post(
      '/system/shutdown',
      { schema: { response: { 202: ShutdownAccepted } } },
      async (request, reply) => {
        request.log.info('shutdown requested over the API');
        await reply.status(202).send({ accepted: true as const });
        // Let the response reach the socket before the server stops accepting.
        setImmediate(options.onShutdownRequested);
        return reply;
      },
    );

    app.post(
      '/system/client-log',
      {
        bodyLimit: CLIENT_LOG_MAX_BYTES,
        schema: { body: ClientLogRequest, response: { 202: ClientLogAccepted } },
      },
      async (request, reply) => {
        if (!limiter.tryAcquire()) {
          throw new AppError({
            code: 'RATE_LIMITED',
            status: 429,
            title: 'Too many client log entries',
            detail: `The client log accepts ${String(CLIENT_LOG_RATE_LIMIT)} entries a minute.`,
            retryable: true,
          });
        }
        const { level, message, context } = request.body;
        request.log[level]({ client: true, ...context }, `[ui] ${message}`);
        await reply.status(202).send({ accepted: true as const });
        return reply;
      },
    );

    done();
  };
