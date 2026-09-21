import {
  EventCore,
  SearchAlias,
  SearchAliasInput,
  SearchAliasList,
  SearchResponse,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { SearchModule } from '../modules/search/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * Search, the core event, and the alias admin API (§8, §10.2, WP-15a).
 *
 * `POST /search/events` is a POST because the query is a structured body, not
 * because it writes. Its body is deliberately *not* a Fastify schema: the
 * service parses it, so a bad query answers `SEARCH_INVALID_QUERY` /
 * `SEARCH_TEXT_TOO_LONG` rather than the generic `VALIDATION_FAILED`.
 */

export interface SearchRouteOptions {
  readonly search: () => SearchModule | undefined;
}

const IdParams = z.object({ id: z.string().min(1).max(64) });
const TermParams = z.object({ term: z.string().min(1).max(120) });

function module(options: SearchRouteOptions): SearchModule {
  const resolved = options.search();
  if (resolved === undefined) {
    throw new Error('search is not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): {
  actor: ReturnType<typeof requireSession>['user'];
  requestId: string;
} {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const searchRoutes =
  (options: SearchRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.post('/search/events', { schema: { response: { 200: SearchResponse } } }, (request) =>
      module(options).service.search(contextOf(request), request.body),
    );

    app.get(
      '/events/:id',
      { schema: { params: IdParams, response: { 200: EventCore } } },
      (request) => module(options).service.detail(contextOf(request), request.params.id),
    );

    app.get(
      '/admin/search-aliases',
      { schema: { response: { 200: SearchAliasList } } },
      (request) => ({
        items: module(options).aliases.listFor(contextOf(request)),
      }),
    );

    app.put(
      '/admin/search-aliases/:term',
      { schema: { params: TermParams, body: SearchAliasInput, response: { 200: SearchAlias } } },
      (request) =>
        module(options).aliases.put(contextOf(request), request.params.term, request.body),
    );

    app.delete(
      '/admin/search-aliases/:term',
      { schema: { params: TermParams } },
      async (request, reply) => {
        module(options).aliases.delete(contextOf(request), request.params.term);
        return reply.status(204).send();
      },
    );

    done();
  };
