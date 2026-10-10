import type {
  Action,
  BackendConnection,
  GuestAvailability,
  LoginResponse,
  MeResponse,
  ProfileInput,
} from '@compintel/contracts';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { setAuthToken } from '../api/auth-token.js';
import { takeJustSetUp } from './first-run.js';
import * as api from '../api/auth.js';
import { isApiProblem, isUnauthorized, type ApiProblem } from '../api/problem.js';

/**
 * Who is signed in (§4.12, §10.5, rulings R37 and R38).
 *
 * The session token lives in this module's memory and nowhere else — not in
 * `localStorage`, not in a cookie, not in the query cache. Closing the window
 * ends the session's presence on the machine, which is exactly what §4.12 asks
 * for, and it is why a reload shows the login screen again.
 */

export type AuthStatus =
  /** No session yet, or the last one ended. */
  | 'SIGNED_OUT'
  /** Signed in, but nothing works until the password changes (ruling R38). */
  | 'MUST_CHANGE_PASSWORD'
  /** Signed in and idle; the server still holds the session (ruling R37). */
  | 'LOCKED'
  | 'READY';

export interface AuthView {
  readonly status: AuthStatus;
  /** The signed-in person, or `undefined` while signed out. */
  readonly me: MeResponse | undefined;
  /** The last thing that went wrong, for the screen to show. */
  readonly error: ApiProblem | undefined;
  /** True while a call is in flight, so a button can be disabled. */
  readonly busy: boolean;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly lock: () => void;
  readonly unlock: (password: string) => Promise<void>;
  readonly changePassword: (current: string, next: string) => Promise<void>;
  /** Re-reads `/me`; the polling fallback when there is no stream (R30). */
  readonly refresh: () => Promise<void>;
  /** Whether the role could ever take this action — for hiding controls (§10.1). */
  readonly can: (action: Action) => boolean;
  /** WP-34 (R132): whether this install offers "Continue as guest"; undefined until known. */
  readonly guest?: GuestAvailability | undefined;
  readonly continueAsGuest?: () => Promise<void>;
  /** R133/R134: "Create my profile" from a guest session; true when it worked. */
  readonly createProfile?: (profile: ProfileInput) => Promise<boolean>;
}

/** The `/me` half of a login answer — everything but the token. */
function meOf(result: LoginResponse): MeResponse {
  const { token: _token, ...me } = result;
  return me;
}

/**
 * Exported for one reason: `src/testing/auth.tsx` puts a stubbed {@link AuthView}
 * here so a test about the rail is not also a test about logging in. Application
 * code goes through {@link useAuth}.
 */
export const AuthContext = createContext<AuthView | undefined>(undefined);

function statusFor(me: MeResponse): AuthStatus {
  return me.user.mustChangePassword ? 'MUST_CHANGE_PASSWORD' : 'READY';
}

export function AuthProvider({
  connection,
  children,
}: {
  readonly connection: BackendConnection;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [me, setMe] = useState<MeResponse | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<ApiProblem | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  /** Runs a call, owning the busy flag and turning a failure into `error`. */
  const run = useCallback(async <T,>(call: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await call();
    } catch (cause) {
      setError(
        isApiProblem(cause)
          ? cause
          : ({ title: 'Something went wrong', detail: String(cause) } as ApiProblem),
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const result = await run(() => api.login(connection, email, password));
      if (result === undefined) {
        return;
      }
      setAuthToken(result.token);
      setLocked(false);
      setMe(meOf(result));
    },
    [connection, run],
  );

  // WP-34 (R132): whether a guest is offered. Asked whenever nobody is signed in;
  // a backend without the route (or a department install) simply says no.
  const [guest, setGuest] = useState<GuestAvailability | undefined>(undefined);
  const signedOut = me === undefined;
  useEffect(() => {
    if (!signedOut) return;
    let current = true;
    api.fetchGuestAvailability(connection).then(
      (answer) => {
        if (current) setGuest(answer);
      },
      () => {
        // No route (an older backend) or no answer: there is simply no guest.
        if (current) setGuest({ available: false, mode: 'DEPARTMENT', automatic: false });
      },
    );
    return () => {
      current = false;
    };
  }, [connection, signedOut]);

  const continueAsGuest = useCallback(async (): Promise<void> => {
    const result = await run(() => api.signInAsGuest(connection));
    if (result === undefined) return;
    setAuthToken(result.token);
    setLocked(false);
    setMe(meOf(result));
  }, [connection, run]);

  // "Myself", still unclaimed: no sign-in screen at all — the app opens as the
  // guest (O-6). Once per mount, so a failure shows the screen instead of looping.
  const triedAutomatic = useRef(false);
  useEffect(() => {
    if (
      signedOut &&
      guest?.available === true &&
      (guest.automatic || takeJustSetUp()) &&
      !triedAutomatic.current
    ) {
      triedAutomatic.current = true;
      void continueAsGuest();
    }
  }, [signedOut, guest, continueAsGuest]);

  const createProfile = useCallback(
    async (profile: ProfileInput): Promise<boolean> => {
      const result = await run(() => api.createProfile(connection, profile));
      if (result === undefined) return false;
      setAuthToken(result.token);
      setMe(meOf(result));
      return true;
    },
    [connection, run],
  );

  const forget = useCallback((): void => {
    setAuthToken(undefined);
    setMe(undefined);
    setLocked(false);
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    // The local state is cleared whatever the server says: if the call failed,
    // the session is still gone from this machine, which is what the user asked
    // for. The row expires on its own.
    await run(() => api.logout(connection)).catch(() => undefined);
    forget();
  }, [connection, forget, run]);

  const unlock = useCallback(
    async (password: string): Promise<void> => {
      const result = await run(() => api.unlock(connection, password));
      if (result === undefined) {
        return;
      }
      setLocked(false);
      setMe((current) =>
        current === undefined || result.session === null
          ? current
          : { ...current, session: result.session },
      );
    },
    [connection, run],
  );

  const changePassword = useCallback(
    async (current: string, next: string): Promise<void> => {
      const result = await run(() => api.changePassword(connection, current, next));
      if (result === undefined) {
        return;
      }
      // The server cleared `must_change_password`; re-read rather than guessing.
      const fresh = await run(() => api.fetchMe(connection));
      if (fresh !== undefined) {
        setMe(fresh);
      }
    },
    [connection, run],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setMe(await api.fetchMe(connection));
    } catch (cause) {
      if (isUnauthorized(cause)) {
        forget();
      }
    }
  }, [connection, forget]);

  const status: AuthStatus = me === undefined ? 'SIGNED_OUT' : locked ? 'LOCKED' : statusFor(me);

  const value = useMemo<AuthView>(
    () => ({
      status,
      me,
      error,
      busy,
      signIn,
      signOut,
      lock: () => {
        setLocked(true);
      },
      unlock,
      changePassword,
      refresh,
      can: (action: Action) => me?.permissions.some((entry) => entry.action === action) ?? false,
      guest,
      continueAsGuest,
      createProfile,
    }),
    [
      status,
      me,
      error,
      busy,
      signIn,
      signOut,
      unlock,
      changePassword,
      refresh,
      guest,
      continueAsGuest,
      createProfile,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthView {
  const value = use(AuthContext);
  if (value === undefined) {
    throw new Error('useAuth() needs an <AuthProvider> above it');
  }
  return value;
}
