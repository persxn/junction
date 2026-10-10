import { MeResponse, permissionsFor, PermissionsResponse } from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { requireSession } from '../platform/authn.js';
import type { GuestService } from '../modules/auth/guest.js';
import type { AuthService } from '../modules/auth/service.js';
import { meBody } from './guest.js';

export interface MeRouteOptions {
  readonly auth: () => AuthService | undefined;
  /** WP-34: adds the installation mode and the guest's state to `/me`. */
  readonly guest?: () => GuestService | undefined;
}

/**
 * `/me` and `/me/permissions` (§10.1).
 *
 * The permission list is explicitly cosmetic: the UI hides controls with it and
 * the server re-decides every write with `assertCan`. It is a separate route
 * from `/me` so a client can refresh it cheaply after a role change without
 * re-reading the session.
 */
export const meRoutes =
  (options: MeRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    app.get('/me', { schema: { response: { 200: MeResponse } } }, (request) => {
      const auth = options.auth();
      const session = requireSession(request);
      if (auth === undefined) {
        throw new Error('the auth service is not available on this backend');
      }
      return meBody(auth, options.guest?.(), session);
    });

    app.get(
      '/me/permissions',
      { schema: { response: { 200: PermissionsResponse } } },
      (request) => ({ permissions: [...permissionsFor(requireSession(request).user.roles)] }),
    );

    done();
  };
