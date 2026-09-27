import { expect } from 'vitest';

import { startSetupTestServer, type SetupTestServer } from './setup-server.js';

/**
 * A set-up installation over a real socket, for the user-administration suites
 * (§10.2 `user.manage`).
 *
 * Extracted in pre-M2a, with the suite split in three. Every case here completes
 * the wizard and signs in, which is two Argon2id hashes at 128 MiB (R17) — about
 * five seconds each — and twelve of them in one file was the longest serial run
 * in `pnpm verify` after the process tests (R89). Three files pay the same cost
 * at the same time instead of one after another.
 */

export const ADMIN_PASSWORD = 'the-first-admin-password';
export const ADMIN_EMAIL = 'admin@example.edu';
const PASSPHRASE = 'a-different-backup-passphrase';

export interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** The server this file started, so a suite's `afterEach` can close it. */
let harness: SetupTestServer | undefined;

export async function closeInstallation(): Promise<void> {
  await harness?.close();
  harness = undefined;
}

export async function call(
  h: SetupTestServer,
  method: string,
  route: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Answer> {
  const response = await fetch(`${h.server.baseUrl}${route}`, {
    method,
    headers: {
      'X-CompIntel-Client': h.server.config.clientSecret,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as never) };
}

export async function signIn(h: SetupTestServer, email: string, password: string): Promise<string> {
  const answer = await call(h, 'POST', '/api/v1/auth/login', {
    body: { email, password, clientKind: 'DESKTOP' },
  });
  if (answer.status !== 200) {
    throw new Error(`login for ${email} failed: ${JSON.stringify(answer.body)}`);
  }
  return answer.body.token as string;
}

/** A set-up installation and the first administrator's token. */
export async function setUp(): Promise<{ h: SetupTestServer; adminToken: string }> {
  harness = await startSetupTestServer();
  const complete = await call(harness, 'POST', '/api/v1/setup/complete', {
    body: {
      organization: { name: 'Example Institute of Technology' },
      department: { name: 'Computer Science and Engineering', code: 'CSE' },
      campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
      admin: {
        email: ADMIN_EMAIL,
        displayName: 'A. Administrator',
        password: ADMIN_PASSWORD,
      },
      scraperContactEmail: 'compintel@example.edu',
      backupDir: harness.backupDir,
      backupPassphrase: PASSPHRASE,
    },
  });
  if (complete.status !== 200) {
    throw new Error(`setup failed: ${JSON.stringify(complete.body)}`);
  }
  return { h: harness, adminToken: await signIn(harness, ADMIN_EMAIL, ADMIN_PASSWORD) };
}

/** Creates a professor and hands back their id and one-time password. */
export async function addProfessor(
  h: SetupTestServer,
  adminToken: string,
  email = 'professor@example.edu',
): Promise<{ id: string; password: string; version: number }> {
  const answer = await call(h, 'POST', '/api/v1/admin/users', {
    token: adminToken,
    body: { email, displayName: 'A. Professor', roles: ['PROFESSOR'] },
  });
  expect(answer.status).toBe(200);
  const user = answer.body.user as { id: string; version: number };
  return {
    id: user.id,
    password: answer.body.temporaryPassword as string,
    version: user.version,
  };
}
