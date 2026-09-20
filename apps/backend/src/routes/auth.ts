import {
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  SessionResponse,
  UnlockRequest,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { requireSession } from '../platform/authn.js';
import type { AuthService } from '../modules/auth/service.js';

export interface AuthRouteOptions {
  /** Undefined on a backend with no database; every route then 401s. */
  readonly auth: () => AuthService | undefined;
}

function service(options: AuthRouteOptions): AuthService {
  const resolved = options.auth();
  if (resolved === undefined) {
    throw new Error('the auth service is not available on this backend');
  }
  return resolved;
}

/**
 * `/auth/*` (ARCHITECTURE.md §4.12, §10, rulings R33, R37, R38).
 *
 * The routes translate and nothing more: every rule — the lockout ladder, which
 * clocks move, what gets audited — is in `AuthService`, so a second caller (the
 * wizard in WP-07b, a future SSO provider behind `AuthProvider`) cannot end up
 * with different behaviour by going round the HTTP layer.
 */
export const authRoutes =
  (options: AuthRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    // The one public route here (§10.3). It is also the only response that ever
    // carries a session token.
    app.post(
      '/auth/login',
      { schema: { body: LoginRequest, response: { 200: LoginResponse } } },
      async (request) => {
        const auth = service(options);
        const result = await auth.login(request.body, {
          clientKind: request.body.clientKind,
          clientLabel: request.body.clientLabel,
          requestId: request.id,
        });
        return { token: result.token, ...auth.describe(result.session) };
      },
    );

    app.post('/auth/logout', { schema: { response: { 200: SessionResponse } } }, (request) => {
      service(options).logout(requireSession(request), request.id);
      return { session: null };
    });

    // Ruling R37: the same session, extended — not a new one. The UI is holding
    // its token in memory and has no way to be handed a different one.
    app.post(
      '/auth/unlock',
      { schema: { body: UnlockRequest, response: { 200: SessionResponse } } },
      async (request) => {
        const auth = service(options);
        const session = await auth.unlock(
          requireSession(request),
          request.body.password,
          request.id,
        );
        return { session };
      },
    );

    // Reachable during a forced change (R38); the hook lets this path through.
    app.post(
      '/auth/change-password',
      { schema: { body: ChangePasswordRequest, response: { 200: SessionResponse } } },
      async (request) => {
        const auth = service(options);
        const session = requireSession(request);
        await auth.changePassword(
          session,
          request.body.currentPassword,
          request.body.newPassword,
          request.id,
        );
        // Re-read, because the change cleared `must_change_password` and the UI
        // decides which screen to show from the next `/me`.
        return { session: auth.expiryOf(session) };
      },
    );

    done();
  };
