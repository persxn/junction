import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Routes whose completion is logged at `debug` rather than `info`. The shell
 * polls `/health` continuously (ADR-0001), and two info lines per poll would
 * drown the log file the 14-day retention is sized for (ruling R11).
 */
const QUIET_ROUTES = new Set(['GET /api/v1/health']);

/** The matched route pattern, or the raw path when nothing matched (a 404). */
export function routeOf(request: FastifyRequest): string {
  return request.routeOptions.url ?? pathOf(request.url);
}

/** The request path with the query string removed (ruling R13). */
export function pathOf(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

/**
 * Ruling R11: Fastify's own two-line-per-request logging is off; this emits one
 * line per completed request instead. 5xx responses are already logged with
 * their cause by the error handler, so this line stays at info for them too.
 */
export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onResponse', (request, reply, done) => {
    const route = routeOf(request);
    const line = {
      method: request.method,
      route,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
      requestId: request.id,
    };
    if (QUIET_ROUTES.has(`${request.method} ${route}`)) {
      request.log.debug(line, 'request');
    } else {
      request.log.info(line, 'request');
    }
    done();
  });
}
