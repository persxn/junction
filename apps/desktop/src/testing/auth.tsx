import { permissionsFor, type AuthUser, type MeResponse, type RoleKey } from '@compintel/contracts';
import { vi } from 'vitest';

import { AuthContext, type AuthStatus, type AuthView } from '../auth/auth-context.js';

/**
 * A signed-in session for tests that are not about signing in.
 *
 * Most of the shell — the rail, the palette, the user menu — only asks `useAuth()`
 * who is here and what they may do. Making each of those tests drive a real login
 * would test the login screen a hundred times and the rail once, so they get this
 * stub instead; `auth/auth-flow.test.tsx` and `auth/auth-lock.test.tsx` are where
 * the real `<AuthProvider>` and its calls are exercised.
 *
 * The permissions come from the contracts matrix rather than a hand-written list,
 * so a test asking for a PROFESSOR gets exactly what the server would send (R32).
 */

export const TEST_USER: AuthUser = {
  id: '0199a0d4-7c3a-7b21-9a4e-6b1f3c2d5e70',
  email: 'ada@example.edu',
  displayName: 'Ada Lovelace',
  departmentId: null,
  status: 'ACTIVE',
  mustChangePassword: false,
};

export interface MockAuthOptions {
  /** Defaults to a professor: the account with no admin capabilities at all. */
  readonly roles?: readonly RoleKey[];
  readonly status?: AuthStatus;
  readonly autoLockMinutes?: number;
  readonly user?: Partial<AuthUser>;
}

export function mockMe(options: MockAuthOptions = {}): MeResponse {
  const roles = options.roles ?? ['PROFESSOR'];
  return {
    user: { ...TEST_USER, ...options.user },
    roles: [...roles],
    permissions: permissionsFor(roles).map((entry) => ({ ...entry })),
    session: {
      idleExpiresAt: '2026-09-20T10:15:00.000Z',
      absoluteExpiresAt: '2026-09-20T22:00:00.000Z',
      autoLockMinutes: options.autoLockMinutes ?? 15,
    },
  };
}

/** An {@link AuthView} whose every call is a spy, so a test can assert on it. */
export function mockAuth(options: MockAuthOptions = {}): AuthView {
  const me = mockMe(options);
  return {
    status: options.status ?? 'READY',
    me,
    error: undefined,
    busy: false,
    signIn: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    lock: vi.fn(),
    unlock: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    can: (action) => me.permissions.some((entry) => entry.action === action),
  };
}

export function MockAuthProvider({
  value,
  children,
}: {
  readonly value: AuthView;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <AuthContext value={value}>{children}</AuthContext>;
}
