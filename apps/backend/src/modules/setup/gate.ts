import type { FastifyInstance } from 'fastify';

import { pathOf } from '../../platform/request-log.js';
import { setupRequired, type SetupService } from './service.js';

/**
 * The R39 setup gate.
 *
 * Until an ACTIVE administrator exists, the only things that answer are the
 * health check, the wizard's own routes and the crash-report sink. Everything
 * else is a 409 `SETUP_REQUIRED` — including `/auth/login`, because there is
 * nobody to log in as, and a 401 there would send the UI to a login screen that
 * can never succeed.
 *
 * It is server-side on purpose: a reload, a typed URL or a rebuilt front end
 * cannot route past it, which is the §19 acceptance criterion.
 */

/** Paths that work while setup is still required. */
export function setupExemptPaths(apiPrefix: string): ReadonlySet<string> {
  return new Set([
    `${apiPrefix}/health`,
    // Ruling A19: the UI must be able to report a crash from inside the wizard.
    `${apiPrefix}/system/client-log`,
    // The shell's "Exit completely" has to work from the wizard too.
    `${apiPrefix}/system/shutdown`,
  ]);
}

export interface SetupGateOptions {
  readonly apiPrefix: string;
  /** Undefined on a backend with no database; the gate then stands aside. */
  readonly setup: () => SetupService | undefined;
}

export function registerSetupGate(app: FastifyInstance, options: SetupGateOptions): void {
  const exempt = setupExemptPaths(options.apiPrefix);
  const wizardPrefix = `${options.apiPrefix}/setup/`;

  app.addHook('preHandler', (request, _reply, done) => {
    const path = pathOf(request.url);
    if (
      request.method === 'OPTIONS' ||
      exempt.has(path) ||
      path.startsWith(wizardPrefix) ||
      path === `${options.apiPrefix}/setup`
    ) {
      done();
      return;
    }

    const service = options.setup();
    if (service?.isRequired() === true) {
      done(setupRequired());
      return;
    }
    done();
  });
}
