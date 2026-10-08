import { DeadlineListResponse, DeadlineQuery } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { DeadlinesModule } from '../modules/deadlines/wiring.js';
import { requireSession } from '../platform/authn.js';

/** `GET /deadlines` (WP-22, R106–R107): the Radar's items and per-bucket counts. */

export interface DeadlinesRouteOptions {
  readonly deadlines: () => DeadlinesModule | undefined;
}

export const deadlinesRoutes =
  (options: DeadlinesRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get(
      '/deadlines',
      { schema: { querystring: DeadlineQuery, response: { 200: DeadlineListResponse } } },
      (r) => {
        const module = options.deadlines();
        if (module === undefined) throw new Error('deadlines are not available on this backend');
        return module.service.list(requireSession(r).user, r.query);
      },
    );
    done();
  };
