import {
  permissionsFor,
  problemType,
  type ErrorCode,
  type LoginResponse,
  type MeResponse,
  type RoleKey,
} from '@compintel/contracts';
import { vi } from 'vitest';

import { TEST_USER } from './auth.js';

/**
 * A stand-in for the loopback API, for the tests that drive the real
 * `<AuthProvider>`.
 *
 * It answers `/auth/*`, `/me` and `/stream` the way `routes/auth.ts` does — the
 * same problem+json shapes, the same 401 when the bearer token is wrong — so the
 * UI is tested against the contract rather than against a mock of itself. The
 * backend's own behaviour is `apps/backend/src/routes/auth.test.ts`; this is only
 * as much server as the screens can tell apart.
 */

export const SESSION_TOKEN = 'a-session-token-that-must-never-be-stored';
export const CORRECT_PASSWORD = 'correct-horse-battery';

export interface FakeApiOptions {
  readonly roles?: readonly RoleKey[];
  readonly mustChangePassword?: boolean;
  readonly autoLockMinutes?: number;
}

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  /** What the request carried in `Authorization`, if anything. */
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

export interface FakeApi {
  readonly calls: readonly RecordedCall[];
  /** Calls that reached a route needing a session, with the token they used. */
  authorizedTokens(): readonly string[];
  me(): MeResponse;
}

function problem(status: number, code: ErrorCode, title: string, detail: string): unknown {
  return {
    type: problemType(code),
    title,
    status,
    code,
    detail,
    requestId: '0199a0d4-7c3a-7b21-9a4e-000000000001',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** An SSE response that stays open, so nothing reconnects behind the test. */
function streamResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(''),
    body: { getReader: () => ({ read: () => new Promise<never>(() => undefined) }) },
  } as unknown as Response;
}

/**
 * Stubs `globalThis.fetch` and hands back what it saw. Every test that uses it
 * must also reset the API client's transport and the in-memory token.
 */
export function installFakeApi(options: FakeApiOptions = {}): FakeApi {
  const roles = options.roles ?? ['PROFESSOR'];
  const calls: RecordedCall[] = [];
  let password = CORRECT_PASSWORD;
  let mustChangePassword = options.mustChangePassword ?? false;

  const session = {
    idleExpiresAt: '2026-09-20T10:15:00.000Z',
    absoluteExpiresAt: '2026-09-20T22:00:00.000Z',
    autoLockMinutes: options.autoLockMinutes ?? 15,
  };

  const me = (): MeResponse => ({
    user: { ...TEST_USER, mustChangePassword },
    roles: [...roles],
    permissions: permissionsFor(roles).map((entry) => ({ ...entry })),
    session,
  });

  const loginBody = (): LoginResponse => ({ ...me(), token: SESSION_TOKEN });

  const unauthenticated = (): Response =>
    jsonResponse(
      401,
      problem(401, 'AUTH_SESSION_EXPIRED', 'Your session ended', 'Sign in again to carry on.'),
    );

  const handle = (call: RecordedCall): Response => {
    const authorized = call.authorization === `Bearer ${SESSION_TOKEN}`;
    const given = typeof call.body?.password === 'string' ? call.body.password : undefined;

    switch (`${call.method} ${call.path}`) {
      case 'POST /api/v1/auth/login':
        if (call.body?.password !== password) {
          return jsonResponse(
            401,
            problem(
              401,
              'AUTH_INVALID_CREDENTIALS',
              'Email or password is wrong',
              'Check both and try again. Five wrong attempts lock the account for five minutes.',
            ),
          );
        }
        return jsonResponse(200, loginBody());

      case 'POST /api/v1/auth/logout':
        return authorized ? jsonResponse(200, { session: null }) : unauthenticated();

      case 'POST /api/v1/auth/unlock':
        if (!authorized) {
          return unauthenticated();
        }
        if (given !== password) {
          return jsonResponse(
            401,
            problem(
              401,
              'AUTH_INVALID_CREDENTIALS',
              'That password does not match',
              'Enter the password for this account, or sign out instead.',
            ),
          );
        }
        // Ruling R37: the same session, extended — no new token.
        return jsonResponse(200, { session });

      case 'POST /api/v1/auth/change-password': {
        if (!authorized) {
          return unauthenticated();
        }
        if (call.body?.currentPassword !== password) {
          return jsonResponse(
            401,
            problem(
              401,
              'AUTH_INVALID_CREDENTIALS',
              'That password does not match',
              'Enter the password you signed in with.',
            ),
          );
        }
        password = String(call.body.newPassword);
        mustChangePassword = false;
        return jsonResponse(200, { session });
      }

      case 'GET /api/v1/me':
        return authorized ? jsonResponse(200, me()) : unauthenticated();

      case 'GET /api/v1/me/permissions':
        return authorized
          ? jsonResponse(200, { permissions: me().permissions })
          : unauthenticated();

      case 'GET /api/v1/stream':
        return authorized ? streamResponse() : unauthenticated();

      default:
        return jsonResponse(
          404,
          problem(404, 'NOT_FOUND', 'No such route', `Nothing answers ${call.path} here.`),
        );
    }
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: RecordedCall = {
        method: init?.method ?? 'GET',
        path: new URL(url).pathname,
        authorization: headers.Authorization,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      };
      calls.push(call);
      return Promise.resolve(handle(call));
    }),
  );

  return {
    calls,
    authorizedTokens: () =>
      calls
        .map((call) => call.authorization)
        .filter((value): value is string => value !== undefined),
    me,
  };
}
