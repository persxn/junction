import {
  EventImportResult,
  ManualEventInput,
  UrlImportCommitRequest,
  UrlImportRequest,
  UrlImportResult,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { EventImportService, ImportServiceContext } from '../modules/events/import/service.js';
import { requireSession } from '../platform/authn.js';

/**
 * Manual event creation and URL import (§10.2, D-30, WP-14).
 *
 * Three routes, no decisions. Authorization, the rate limit, the dispatch and
 * every write are the service's; a route that decided any of them would be a
 * rule the AI tools and the jobs could not reach (§3.3).
 *
 * `preview` is a POST although it reads: the URL is a request *body* rather than
 * a query parameter, because a pasted link is user data that has no business in
 * a URL, a log line or a browser history — and the call is not idempotent from
 * the site's point of view either, since it fetches their page.
 */

export interface EventsRouteOptions {
  readonly imports: () => EventImportService | undefined;
}

function service(options: EventsRouteOptions): EventImportService {
  const resolved = options.imports();
  if (resolved === undefined) {
    throw new Error('event import is not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): ImportServiceContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const eventsRoutes =
  (options: EventsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.post(
      '/events',
      { schema: { body: ManualEventInput, response: { 200: EventImportResult } } },
      (request) => service(options).createManual(contextOf(request), request.body),
    );

    app.post(
      '/events/import/preview',
      { schema: { body: UrlImportRequest, response: { 200: UrlImportResult } } },
      async (request) => service(options).preview(contextOf(request), request.body),
    );

    app.post(
      '/events/import/commit',
      { schema: { body: UrlImportCommitRequest, response: { 200: EventImportResult } } },
      async (request) => service(options).commit(contextOf(request), request.body),
    );

    done();
  };
