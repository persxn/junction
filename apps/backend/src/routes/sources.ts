import {
  SetSourceCredentialRequest,
  SetSourceSessionRequest,
  SourceCredentialStatus,
  SourceListResponse,
  SourceRefreshResult,
  SourceResponse,
  SourceSessionStatus,
  SourceStatusResponse,
  UpdateSourceRequest,
} from '@compintel/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { SourcesService, SourcesServiceContext } from '../modules/sources/service.js';
import { requireSession } from '../platform/authn.js';

/**
 * `/sources` and `/admin/sources` (§7.2, §10.2, WP-16b renders the status list).
 *
 * The split is the §10.2 matrix. Reading is available to anyone signed in — "how
 * fresh is this data and where did it come from?" is a question a professor
 * looking at an event has a right to ask — while every write goes through
 * `source.manage`, which only an administrator has.
 *
 * `PATCH` accepts five fields and `compliance_status` is not one of them. It is
 * absent from `UpdateSourceRequest`, so a request carrying it is rejected by the
 * schema before a handler sees it: `.strict()` makes the rule a 400 rather than
 * a silently ignored field.
 */

export interface SourcesRouteOptions {
  readonly sources: () => SourcesService | undefined;
}

const SourceParams = z.object({ key: z.string().min(1).max(64) });

function service(options: SourcesRouteOptions): SourcesService {
  const resolved = options.sources();
  if (resolved === undefined) {
    throw new Error('source administration is not available on this backend');
  }
  return resolved;
}

function contextOf(request: FastifyRequest): SourcesServiceContext {
  return { actor: requireSession(request).user, requestId: request.id };
}

export const sourcesRoutes =
  (options: SourcesRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/sources', { schema: { response: { 200: SourceListResponse } } }, () => ({
      sources: [...service(options).list()],
    }));

    // WP-16b: the §16.1 freshness popover. The compliance fields are in the
    // response only for an administrator (§10.2) — the service decides, from the
    // session, so a professor cannot ask for them by any spelling of the URL.
    app.get('/sources/status', { schema: { response: { 200: SourceStatusResponse } } }, (request) =>
      service(options).statusView(requireSession(request).user),
    );

    app.patch(
      '/admin/sources/:key',
      {
        schema: {
          params: SourceParams,
          body: UpdateSourceRequest,
          response: { 200: SourceResponse },
        },
      },
      (request) => ({
        source: service(options).update(contextOf(request), request.params.key, request.body),
      }),
    );

    // WP-11: a source's API credential. The body is never echoed; both answers
    // are `{ isSet }` and nothing else.
    app.get(
      '/admin/sources/:key/credential',
      { schema: { params: SourceParams, response: { 200: SourceCredentialStatus } } },
      (request) => service(options).credentialStatus(contextOf(request), request.params.key),
    );

    app.put(
      '/admin/sources/:key/credential',
      {
        schema: {
          params: SourceParams,
          body: SetSourceCredentialRequest,
          response: { 200: SourceCredentialStatus },
        },
      },
      (request) =>
        service(options).setCredential(contextOf(request), request.params.key, request.body),
    );

    // WP-14/R74: the professor's own session. `GET` answers state, never the
    // cookie; `PUT` takes one; `DELETE` signs the app out. Admin-only, like
    // every other write here (§10.2 `source.manage`).
    app.get(
      '/admin/sources/:key/session',
      { schema: { params: SourceParams, response: { 200: SourceSessionStatus } } },
      (request) => service(options).sessionStatus(contextOf(request), request.params.key),
    );

    app.put(
      '/admin/sources/:key/session',
      {
        schema: {
          params: SourceParams,
          body: SetSourceSessionRequest,
          response: { 200: SourceSessionStatus },
        },
      },
      (request) =>
        service(options).setSession(contextOf(request), request.params.key, request.body),
    );

    app.delete(
      '/admin/sources/:key/session',
      { schema: { params: SourceParams, response: { 200: SourceSessionStatus } } },
      (request) => service(options).clearSession(contextOf(request), request.params.key),
    );

    app.post(
      '/admin/sources/:key/refresh',
      { schema: { params: SourceParams, response: { 200: SourceRefreshResult } } },
      async (request) => service(options).refresh(contextOf(request), request.params.key),
    );

    done();
  };
