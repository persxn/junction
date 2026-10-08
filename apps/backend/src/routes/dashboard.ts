import { KpiQuery, KpiResponse } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { KpiService } from '../modules/dashboard/kpis.js';
import { requireSession } from '../platform/authn.js';

/** `GET /dashboard/kpis` (WP-22, R107): each tile with the filter of the list it opens. */

export interface DashboardRouteOptions {
  readonly kpis: () => KpiService | undefined;
}

export const dashboardRoutes =
  (options: DashboardRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get(
      '/dashboard/kpis',
      { schema: { querystring: KpiQuery, response: { 200: KpiResponse } } },
      (r) => {
        const kpis = options.kpis();
        if (kpis === undefined) throw new Error('the dashboard is not available on this backend');
        return kpis.tiles(requireSession(r).user, r.query.scope);
      },
    );
    done();
  };
