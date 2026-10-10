import { Appearance, AppearanceInput, InsightsQuery, InsightsResponse } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { readAppearance, writeAppearance } from '../modules/appearance/settings.js';
import type { InsightsService } from '../modules/dashboard/insights.js';
import { requireSession } from '../platform/authn.js';
import type { SettingsStore } from '../platform/settings.js';

/**
 * WP-33: `GET /insights` (R69) and the caller's own appearance (R67–R68).
 * Appearance is always the session's user — never a parameter — so nobody can
 * read or change another person's theme.
 */

export interface InsightsRouteOptions {
  readonly insights: () => InsightsService | undefined;
  readonly settings: () => SettingsStore | undefined;
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is not available on this backend`);
  return value;
}

export const insightsRoutes =
  (options: InsightsRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get(
      '/insights',
      { schema: { querystring: InsightsQuery, response: { 200: InsightsResponse } } },
      (request) =>
        need(options.insights(), 'insights').read(requireSession(request).user, request.query),
    );

    app.get('/me/appearance', { schema: { response: { 200: Appearance } } }, (request) =>
      readAppearance(need(options.settings(), 'settings'), requireSession(request).user.id),
    );

    app.put(
      '/me/appearance',
      { schema: { body: AppearanceInput, response: { 200: Appearance } } },
      (request) =>
        writeAppearance(
          need(options.settings(), 'settings'),
          requireSession(request).user.id,
          request.body,
        ),
    );

    done();
  };
