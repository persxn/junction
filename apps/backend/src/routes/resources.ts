import {
  CheckResultsRequest,
  CheckResultsResponse,
  Resource,
  ResourceCreateRequest,
  ResourceDeleteRequest,
  ResourceList,
  ResourceUpdateRequest,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ResourcesContext } from '../modules/resources/service.js';
import type { ResourcesModule } from '../modules/resources/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * Resources (WP-20b, R103): one competition's at every level under
 * `/competitions/:id/resources` — WP-19 named the resource "competitions" —
 * and the writes under `/resources`. The backend checks shape only; the shell
 * checks paths and posts what it found to `/resources/check-results`.
 */

export interface ResourcesRouteOptions {
  readonly resources: () => ResourcesModule | undefined;
}

const Id = z.string().min(1).max(64);
const P = z.object({ id: Id });

function module(options: ResourcesRouteOptions): ResourcesModule {
  const resolved = options.resources();
  if (resolved === undefined) throw new Error('resources are not available on this backend');
  return resolved;
}

const contextOf = (request: FastifyRequest): ResourcesContext => ({
  actor: requireSession(request).user,
  requestId: request.id,
});

export const resourcesRoutes =
  (options: ResourcesRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const m = (): ResourcesModule => module(options);

    app.get(
      '/competitions/:id/resources',
      { schema: { params: P, response: { 200: ResourceList } } },
      (r) => m().service.list(contextOf(r).actor, r.params.id),
    );
    app.post(
      '/resources',
      { schema: { body: ResourceCreateRequest, response: { 200: Resource } } },
      (r) => m().service.create(contextOf(r), r.body),
    );
    // Before `/resources/:id`, so the literal path is never read as an id.
    app.post(
      '/resources/check-results',
      { schema: { body: CheckResultsRequest, response: { 200: CheckResultsResponse } } },
      (r) => ({ updated: m().service.recordChecks(contextOf(r), r.body) }),
    );
    app.patch(
      '/resources/:id',
      { schema: { params: P, body: ResourceUpdateRequest, response: { 200: Resource } } },
      (r) => m().service.update(contextOf(r), r.params.id, r.body),
    );
    app.delete(
      '/resources/:id',
      { schema: { params: P, body: ResourceDeleteRequest } },
      async (r, reply) => {
        m().service.remove(contextOf(r), r.params.id, r.body.version);
        await reply.code(204).send();
      },
    );
    done();
  };
