import type { FastifyInstance, FastifyRequest } from 'fastify';

import { passwordChangeRequired } from '../modules/auth/errors.js';
import type { AuthService } from '../modules/auth/service.js';
import type { ActiveSession } from '../modules/auth/types.js';
import { bearerToken } from '../modules/auth/tokens.js';
import { unauthorized } from './errors.js';
import { pathOf } from './request-log.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the hook below on every authenticated route. */
    session?: ActiveSession;
  }
}

/**
 * Session authentication (§10.3, ADR-0017, rulings R18 and R38).
 *
 * It is a **preHandler**, not an `onRequest` hook, so it runs after CORS has put
 * its headers on the reply (R18): a 401 the browser cannot read is a 401 the UI
 * cannot act on.
 *
 * §10.3 is the rule — "all endpoints except `/health` and `/auth/login` require
 * a valid session" — with two documented additions below.
 */

/** Paths that work without a session. Everything else needs one. */
export function publicPaths(apiPrefix: string): ReadonlySet<string> {
  return new Set([
    // §10.3, verbatim.
    `${apiPrefix}/health`,
    `${apiPrefix}/auth/login`,
    // WP-34 (R132): the student edition's password-less guest. It answers 404
    // anywhere the guest is not offered, so being public gives nothing away.
    `${apiPrefix}/auth/guest`,
    // Ruling A19: the client secret is its whole gate, by design — the UI has to
    // be able to report a crash that happened before anyone signed in.
    `${apiPrefix}/system/client-log`,
    // The shell's "Exit completely" (§3.2). It must work before login, and in
    // host mode the per-spawn client secret already proves the caller is the
    // shell we started. Flagged for the architect; in server mode it needs an
    // admin session.
    `${apiPrefix}/system/shutdown`,
    // Ruling R39: the UI asks this before it knows whether there is anyone to
    // sign in as. It only ever says whether the wizard is needed.
    `${apiPrefix}/setup/status`,
    // Also always open, and always refused once an administrator exists: a 401
    // here would suggest that signing in lets you run setup again, and nothing
    // does. The service answers `SETUP_ALREADY_DONE` instead.
    `${apiPrefix}/setup/complete`,
  ]);
}

/**
 * Ruling R38: while `must_change_password` is set, login succeeds and then
 * everything answers 403 except the three routes that let the user fix it.
 */
export function passwordChangeAllowedPaths(apiPrefix: string): ReadonlySet<string> {
  return new Set([
    `${apiPrefix}/auth/change-password`,
    `${apiPrefix}/auth/logout`,
    `${apiPrefix}/me`,
  ]);
}

export interface AuthenticationOptions {
  readonly apiPrefix: string;
  /**
   * Ruling R39: while the wizard is still required there is no account to
   * authenticate as, so the rest of `/setup/*` — the folder probe — answers
   * without a session. Once an administrator exists it needs one like
   * everything else.
   */
  readonly setupRequired?: () => boolean;
  /**
   * Resolved lazily: the service is built after the database opens, and some
   * tests build an app with no database at all, where every guarded route must
   * simply answer 401.
   */
  readonly auth: () => AuthService | undefined;
}

/** The session on a request that has been through the hook, or a 401. */
export function requireSession(request: FastifyRequest): ActiveSession {
  const session = request.session;
  if (session === undefined) {
    throw unauthorized('This route needs a signed-in session.');
  }
  return session;
}

export function registerAuthentication(app: FastifyInstance, options: AuthenticationOptions): void {
  const open = publicPaths(options.apiPrefix);
  const duringForcedChange = passwordChangeAllowedPaths(options.apiPrefix);
  const setupPrefix = `${options.apiPrefix}/setup/`;
  const setupRequired = options.setupRequired ?? ((): boolean => false);

  app.addHook('preHandler', (request, _reply, done) => {
    const path = pathOf(request.url);
    if (request.method === 'OPTIONS' || open.has(path)) {
      done();
      return;
    }
    if (path.startsWith(setupPrefix) && setupRequired()) {
      done();
      return;
    }

    const service = options.auth();
    if (service === undefined) {
      done(
        unauthorized(
          'Accounts are not available on this backend.',
          'The database was not opened, so nobody can be signed in.',
        ),
      );
      return;
    }

    const token = bearerToken(request.headers.authorization);
    if (token === undefined) {
      done(unauthorized('This route needs an Authorization: Bearer <token> header.'));
      return;
    }

    try {
      const session = service.authenticate(token);
      request.session = session;
      if (session.user.mustChangePassword && !duringForcedChange.has(path)) {
        done(passwordChangeRequired());
        return;
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });
}
