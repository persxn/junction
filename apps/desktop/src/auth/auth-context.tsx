import type { Action, BackendConnection, MeResponse } from '@compintel/contracts';
import { createContext, use, useCallback, useMemo, useState } from 'react';

import { setAuthToken } from '../api/auth-token.js';
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
      setMe({
        user: result.user,
        roles: result.roles,
        permissions: result.permissions,
        session: result.session,
      });
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
    }),
    [status, me, error, busy, signIn, signOut, unlock, changePassword, refresh],
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
