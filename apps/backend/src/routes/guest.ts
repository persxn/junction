import {
  GuestAvailability,
  GuestToggleRequest,
  LoginResponse,
  PlaceQuery,
  PlaceSuggestionsResponse,
  ProfileRequest,
  type MeResponse,
} from '@compintel/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { GuestService } from '../modules/auth/guest.js';
import type { AuthService } from '../modules/auth/service.js';
import type { ActiveSession } from '../modules/auth/types.js';
import type { PlacesService } from '../modules/geo/places.js';
import { setupAlreadyDone, type SetupService } from '../modules/setup/service.js';
import { requireSession } from '../platform/authn.js';

/**
 * The student edition's routes (WP-34, rulings R130–R134): the guest's sign-in,
 * "Create my profile", the lead's guest switch and the wizard's place picker.
 */

export interface GuestRouteOptions {
  readonly auth: () => AuthService | undefined;
  readonly guest: () => GuestService | undefined;
  readonly setup: () => SetupService | undefined;
  readonly places: () => PlacesService | undefined;
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the ${what} service is not available on this backend`);
  }
  return value;
}

/** `/me` plus what only the student edition knows: the mode and the guest's state. */
export function meBody(
  auth: AuthService,
  guest: GuestService | undefined,
  session: ActiveSession,
): MeResponse {
  const availability = guest?.availability();
  return {
    ...auth.describe(session),
    ...(availability === undefined
      ? {}
      : { mode: availability.mode, guestEnabled: availability.available }),
  };
}

export const guestRoutes =
  (options: GuestRouteOptions): FastifyPluginCallbackZod =>
  (app, _opts, done) => {
    // Public (authn.ts): the sign-in screen asks before anybody is signed in.
    app.get('/auth/guest', { schema: { response: { 200: GuestAvailability } } }, () =>
      need(options.guest(), 'guest').availability(),
    );

    app.post('/auth/guest', { schema: { response: { 200: LoginResponse } } }, (request) => {
      const auth = need(options.auth(), 'auth');
      const guest = need(options.guest(), 'guest');
      const result = guest.signIn({ requestId: request.id });
      return { token: result.token, ...meBody(auth, guest, result.session) };
    });

    app.post(
      '/me/profile',
      { schema: { body: ProfileRequest, response: { 200: LoginResponse } } },
      async (request) => {
        const auth = need(options.auth(), 'auth');
        const guest = need(options.guest(), 'guest');
        const result = await guest.createProfile(requireSession(request), request.body, {
          requestId: request.id,
        });
        return { token: result.token, ...meBody(auth, guest, result.session) };
      },
    );

    app.put(
      '/admin/guest',
      { schema: { body: GuestToggleRequest, response: { 200: GuestAvailability } } },
      (request) =>
        need(options.guest(), 'guest').setEnabled(
          requireSession(request).user,
          request.body.enabled,
        ),
    );

    // Open only while the wizard runs (the R39 hooks let `/setup/*` through then).
    app.get(
      '/setup/places',
      { schema: { querystring: PlaceQuery, response: { 200: PlaceSuggestionsResponse } } },
      (request) => {
        if (options.setup()?.isRequired() !== true) {
          throw setupAlreadyDone();
        }
        return { places: [...need(options.places(), 'places').suggest(request.query.q)] };
      },
    );

    done();
  };
