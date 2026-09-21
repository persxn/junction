import { EventCategoriesInput, EventCategoriesResult, EventDetailView } from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { EventCategoriesService } from '../modules/events/categories.js';
import type { EventDetailContext, EventDetailService } from '../modules/events/detail.js';
import { requireSession } from '../platform/authn.js';

/**
 * The event detail drawer's two routes (§16.2, §10.2, WP-16b).
 *
 * `GET /events/:id/detail` answers everything the drawer shows in one call —
 * the reason it is not six routes is that a drawer whose sections appear one by
 * one is a drawer nobody trusts. "Load older" on the change history goes to the
 * existing `GET /events/:id/changes`, which pages the same shape.
 */

export interface EventDetailRouteOptions {
  readonly detail: () => EventDetailService | undefined;
  readonly categories: () => EventCategoriesService | undefined;
}

const IdParams = z.object({ id: z.string().min(1).max(64) });

function detailService(options: EventDetailRouteOptions): EventDetailService {
  const resolved = options.detail();
  if (resolved === undefined) {
    throw new Error('event detail is not available on this backend');
  }
  return resolved;
}

function categoriesService(options: EventDetailRouteOptions): EventCategoriesService {
  const resolved = options.categories();
  if (resolved === undefined) {
    throw new Error('category overrides are not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): EventDetailContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const eventDetailRoutes =
  (options: EventDetailRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get(
      '/events/:id/detail',
      { schema: { params: IdParams, response: { 200: EventDetailView } } },
      (request) => detailService(options).detail(contextOf(request), request.params.id),
    );

    app.put(
      '/events/:id/categories',
      {
        schema: {
          params: IdParams,
          body: EventCategoriesInput,
          response: { 200: EventCategoriesResult },
        },
      },
      (request) =>
        categoriesService(options).set(contextOf(request), request.params.id, request.body),
    );

    done();
  };
