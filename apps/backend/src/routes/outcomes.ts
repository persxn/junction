import { OutcomeDeleteRequest, OutcomeInput, OutcomeView } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { OutcomesModule } from '../modules/outcomes/wiring.js';
import { requireSession } from '../platform/authn.js';

/**
 * A competition's outcome (WP-21, R104) under `/competitions/:id/outcome` —
 * WP-19 named the resource "competitions". Reading it comes with the
 * competition's page; these are the writes.
 */

export interface OutcomesRouteOptions {
  readonly outcomes: () => OutcomesModule | undefined;
}

const P = z.object({ id: z.string().min(1).max(64) });

export const outcomesRoutes =
  (options: OutcomesRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    const m = (): OutcomesModule => {
      const resolved = options.outcomes();
      if (resolved === undefined) throw new Error('outcomes are not available on this backend');
      return resolved;
    };
    app.put(
      '/competitions/:id/outcome',
      { schema: { params: P, body: OutcomeInput, response: { 200: OutcomeView } } },
      (r) =>
        m().service.record({ actor: requireSession(r).user, requestId: r.id }, r.params.id, r.body),
    );
    app.delete(
      '/competitions/:id/outcome',
      { schema: { params: P, body: OutcomeDeleteRequest } },
      async (r, reply) => {
        m().service.remove(
          { actor: requireSession(r).user, requestId: r.id },
          r.params.id,
          r.body.version,
        );
        await reply.code(204).send();
      },
    );
    done();
  };
