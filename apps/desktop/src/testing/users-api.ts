import { vi } from 'vitest';

/**
 * Admin → Users, as far as the screen can tell.
 *
 * Extracted when ruling R89 split the axe passes into their own project: the
 * behaviour suite and the accessibility suite need the same two accounts and the
 * same answers, and a second copy of them would be a second thing to keep in
 * step.
 */

export const ADMIN = {
  id: '0192f0c1-0000-7000-8000-000000000001',
  email: 'admin@example.edu',
  displayName: 'A. Administrator',
  departmentId: null,
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['ADMINISTRATOR', 'PROFESSOR'],
  lastLoginAt: '2026-09-20T09:00:00.000Z',
  lockedUntil: null,
  createdAt: '2026-09-20T08:00:00.000Z',
  version: 1,
};

export const PROFESSOR = {
  ...ADMIN,
  id: '0192f0c1-0000-7000-8000-000000000002',
  email: 'professor@example.edu',
  displayName: 'A. Professor',
  roles: ['PROFESSOR'],
  mustChangePassword: true,
  lastLoginAt: null,
  version: 3,
};

/** The password the server generates once and never repeats (ruling R38). */
export const ONE_TIME = 'Hx7kPq2mRt9vBn4W';

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

export interface UsersApiOptions {
  readonly users?: unknown[];
  readonly failCreate?: boolean;
}

/** Stubs `fetch` and returns the list every call is recorded in. */
export function installUsersApi(options: UsersApiOptions = {}): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        path,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as never) : undefined,
      });

      const json = (status: number, body: unknown): Response =>
        ({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(JSON.stringify(body)),
        }) as unknown as Response;

      if (path === '/api/v1/admin/users' && method === 'GET') {
        return Promise.resolve(json(200, { users: options.users ?? [ADMIN, PROFESSOR] }));
      }
      if (path === '/api/v1/admin/users' && method === 'POST') {
        if (options.failCreate === true) {
          return Promise.resolve(
            json(409, {
              type: 'urn:compintel:problem:CONFLICT',
              title: 'That does not fit the current state',
              detail: 'An account for taken@example.edu already exists.',
              status: 409,
              code: 'CONFLICT',
              requestId: '0199a0d4-0000-7000-8000-000000000001',
            }),
          );
        }
        return Promise.resolve(
          json(200, {
            user: { ...PROFESSOR, email: 'new@example.edu', displayName: 'New Person' },
            temporaryPassword: ONE_TIME,
          }),
        );
      }
      if (path.endsWith('/reset-password')) {
        return Promise.resolve(json(200, { user: PROFESSOR, temporaryPassword: ONE_TIME }));
      }
      if (path.endsWith('/disable') || path.endsWith('/enable')) {
        return Promise.resolve(json(200, { user: PROFESSOR }));
      }
      if (method === 'PATCH') {
        return Promise.resolve(json(200, { user: PROFESSOR }));
      }
      return Promise.resolve(json(404, {}));
    }),
  );
  return calls;
}
