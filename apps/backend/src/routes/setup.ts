import {
  PathCheckRequest,
  PathCheckResult,
  SetupRequest,
  SetupResult,
  SetupStatus,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { SetupService } from '../modules/setup/service.js';

export interface SetupRouteOptions {
  /** Undefined on a backend with no database. */
  readonly setup: () => SetupService | undefined;
}

function service(options: SetupRouteOptions): SetupService {
  const resolved = options.setup();
  if (resolved === undefined) {
    throw new Error('the setup service is not available on this backend');
  }
  return resolved;
}

/**
 * `/setup/*` (rulings R39–R44).
 *
 * These three are the only routes a fresh installation answers, and they need no
 * session — there is no account to have one with. `complete` closes the door
 * behind itself: once an administrator exists it answers `SETUP_ALREADY_DONE`
 * for ever, so this is not a way to add a second organization later.
 */
export const setupRoutes =
  (options: SetupRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/setup/status', { schema: { response: { 200: SetupStatus } } }, () =>
      service(options).status(),
    );

    // A real write probe on a real folder (R43), so the answer is what the
    // backup job will actually get at 13:00 rather than what the ACL claims.
    app.post(
      '/setup/check-path',
      { schema: { body: PathCheckRequest, response: { 200: PathCheckResult } } },
      (request) => service(options).checkPath(request.body.path),
    );

    app.post(
      '/setup/complete',
      { schema: { body: SetupRequest, response: { 200: SetupResult } } },
      async (request) => service(options).complete(request.body),
    );

    done();
  };
