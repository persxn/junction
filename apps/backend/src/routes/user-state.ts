import { EventUserState, HideInput, WatchlistEntry, WatchlistInput } from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { EventUserStateService, UserStateContext } from '../modules/events/user-state.js';
import { requireSession } from '../platform/authn.js';

/**
 * A professor's own Save and Hide (§10.2, WP-16a). The body is optional on
 * every route; the caller is always the session's user, never a parameter.
 */

export interface UserStateRouteOptions {
  readonly userState: () => EventUserStateService | undefined;
}

const IdParams = z.object({ id: z.string().min(1).max(64) });

function service(options: UserStateRouteOptions): EventUserStateService {
  const resolved = options.userState();
  if (resolved === undefined) {
    throw new Error('saving and hiding events is not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): UserStateContext {
  return { actor: requireSession(request).user };
}

export const userStateRoutes =
  (options: UserStateRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.put(
      '/events/:id/watchlist',
      {
        schema: {
          params: IdParams,
          body: WatchlistInput.nullish(),
          response: { 200: WatchlistEntry },
        },
      },
      (request) =>
        service(options).watch(contextOf(request), request.params.id, request.body ?? {}),
    );

    app.delete(
      '/events/:id/watchlist',
      { schema: { params: IdParams } },
      async (request, reply) => {
        service(options).unwatch(contextOf(request), request.params.id);
        return reply.status(204).send();
      },
    );

    app.post(
      '/events/:id/hide',
      {
        schema: { params: IdParams, body: HideInput.nullish(), response: { 200: EventUserState } },
      },
      (request) => service(options).hide(contextOf(request), request.params.id, request.body ?? {}),
    );

    app.post(
      '/events/:id/unhide',
      { schema: { params: IdParams, response: { 200: EventUserState } } },
      (request) => service(options).unhide(contextOf(request), request.params.id),
    );

    done();
  };
