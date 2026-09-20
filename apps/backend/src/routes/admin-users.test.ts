import { afterEach, describe, expect, it } from 'vitest';

import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * User administration over a real socket (§10.2 `user.manage`).
 *
 * Every case starts from a completed setup, because that is the only way an
 * administrator exists at all — which is itself the point of ruling R39.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PASSPHRASE = 'a-different-backup-passphrase';

let harness: SetupTestServer | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
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

async function signIn(h: SetupTestServer, email: string, password: string): Promise<string> {
  const answer = await call(h, 'POST', '/api/v1/auth/login', {
    body: { email, password, clientKind: 'DESKTOP' },
  });
  if (answer.status !== 200) {
    throw new Error(`login for ${email} failed: ${JSON.stringify(answer.body)}`);
  }
  return answer.body.token as string;
}

/** A set-up installation and the first administrator's token. */
async function setUp(): Promise<{ h: SetupTestServer; adminToken: string }> {
  harness = await startSetupTestServer();
  const complete = await call(harness, 'POST', '/api/v1/setup/complete', {
    body: {
      organization: { name: 'Example Institute of Technology' },
      department: { name: 'Computer Science and Engineering', code: 'CSE' },
      campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
      admin: {
        email: 'admin@example.edu',
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
  return { h: harness, adminToken: await signIn(harness, 'admin@example.edu', ADMIN_PASSWORD) };
}

/** Creates a professor and hands back their id and one-time password. */
async function addProfessor(
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

describe('creating an account', () => {
  it('returns a one-time password and forces a change on the way in (R38)', async () => {
    const { h, adminToken } = await setUp();
    const created = await addProfessor(h, adminToken);

    expect(created.password).toHaveLength(16);

    const list = await call(h, 'GET', '/api/v1/admin/users', { token: adminToken });
    const users = list.body.users as { email: string; mustChangePassword: boolean }[];
    expect(users).toHaveLength(2);
    expect(users.find((user) => user.email === 'professor@example.edu')).toMatchObject({
      mustChangePassword: true,
      status: 'ACTIVE',
      roles: ['PROFESSOR'],
    });

    // The new account can sign in, and then nothing else works until they
    // choose their own password.
    const token = await signIn(h, 'professor@example.edu', created.password);
    const blocked = await call(h, 'GET', '/api/v1/me/permissions', { token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
  }, 60_000);

  it('refuses a duplicate address', async () => {
    const { h, adminToken } = await setUp();
    await addProfessor(h, adminToken);
    const again = await call(h, 'POST', '/api/v1/admin/users', {
      token: adminToken,
      body: { email: 'PROFESSOR@example.edu', displayName: 'Someone Else', roles: ['PROFESSOR'] },
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
  }, 60_000);

  it('never returns a password hash', async () => {
    const { h, adminToken } = await setUp();
    const list = await call(h, 'GET', '/api/v1/admin/users', { token: adminToken });
    expect(JSON.stringify(list.body)).not.toContain('argon2');
  }, 60_000);
});

describe('disabling and enabling', () => {
  it('stops a disabled account signing in, and lets it back', async () => {
    const { h, adminToken } = await setUp();
    const professor = await addProfessor(h, adminToken);

    const disabled = await call(h, 'POST', `/api/v1/admin/users/${professor.id}/disable`, {
      token: adminToken,
    });
    expect(disabled.status).toBe(200);
    expect((disabled.body.user as { status: string }).status).toBe('DISABLED');

    const refused = await call(h, 'POST', '/api/v1/auth/login', {
      body: { email: 'professor@example.edu', password: professor.password },
    });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('AUTH_ACCOUNT_DISABLED');

    await call(h, 'POST', `/api/v1/admin/users/${professor.id}/enable`, { token: adminToken });
    await expect(signIn(h, 'professor@example.edu', professor.password)).resolves.toBeTruthy();
  }, 60_000);

  it('refuses to disable your own account', async () => {
    const { h, adminToken } = await setUp();
    const me = await call(h, 'GET', '/api/v1/me', { token: adminToken });
    const id = (me.body.user as { id: string }).id;

    const answer = await call(h, 'POST', `/api/v1/admin/users/${id}/disable`, {
      token: adminToken,
    });
    expect(answer.status).toBe(409);
    expect(String(answer.body.title)).toContain('cannot disable your own account');
  }, 60_000);

  it('lets one of two administrators go, then refuses the survivor', async () => {
    const { h, adminToken } = await setUp();
    const second = await call(h, 'POST', '/api/v1/admin/users', {
      token: adminToken,
      body: {
        email: 'second@example.edu',
        displayName: 'Second Administrator',
        roles: ['ADMINISTRATOR'],
      },
    });
    const secondId = (second.body.user as { id: string }).id;

    // Two administrators, so letting one go is allowed.
    const disabled = await call(h, 'POST', `/api/v1/admin/users/${secondId}/disable`, {
      token: adminToken,
    });
    expect(disabled.status).toBe(200);

    // The survivor is now the only one, and cannot remove themselves either —
    // here the self-guard is what catches it, and demoting is covered below.
    const me = await call(h, 'GET', '/api/v1/me', { token: adminToken });
    const mine = (me.body.user as { id: string }).id;
    const answer = await call(h, 'POST', `/api/v1/admin/users/${mine}/disable`, {
      token: adminToken,
    });
    expect(answer.status).toBe(409);
    expect(String(answer.body.title)).toContain('cannot disable your own account');
  }, 90_000);
});

describe('editing', () => {
  it('renames and re-roles, and refuses a stale version with 409', async () => {
    const { h, adminToken } = await setUp();
    const professor = await addProfessor(h, adminToken);

    const renamed = await call(h, 'PATCH', `/api/v1/admin/users/${professor.id}`, {
      token: adminToken,
      body: { displayName: 'Professor Renamed', version: professor.version },
    });
    expect(renamed.status).toBe(200);
    const after = renamed.body.user as { displayName: string; version: number };
    expect(after.displayName).toBe('Professor Renamed');
    expect(after.version).toBe(professor.version + 1);

    // The same version again: somebody else got there first.
    const stale = await call(h, 'PATCH', `/api/v1/admin/users/${professor.id}`, {
      token: adminToken,
      body: { displayName: 'Too Late', version: professor.version },
    });
    expect(stale.status).toBe(409);
    expect(String(stale.body.detail)).toContain('Somebody else changed this account');
  }, 60_000);

  it('refuses to take the Administrator role off the last one', async () => {
    const { h, adminToken } = await setUp();
    const me = await call(h, 'GET', '/api/v1/me', { token: adminToken });
    const admin = me.body.user as { id: string };
    const list = await call(h, 'GET', '/api/v1/admin/users', { token: adminToken });
    const version = (list.body.users as { id: string; version: number }[]).find(
      (user) => user.id === admin.id,
    )?.version;

    const answer = await call(h, 'PATCH', `/api/v1/admin/users/${admin.id}`, {
      token: adminToken,
      body: { roles: ['PROFESSOR'], version },
    });
    expect(answer.status).toBe(409);
    expect(String(answer.body.title)).toContain('last administrator');
  }, 60_000);
});

describe('resetting a password', () => {
  it('kills the old password and the sessions that used it', async () => {
    const { h, adminToken } = await setUp();
    const professor = await addProfessor(h, adminToken);
    const theirToken = await signIn(h, 'professor@example.edu', professor.password);

    const reset = await call(h, 'POST', `/api/v1/admin/users/${professor.id}/reset-password`, {
      token: adminToken,
    });
    expect(reset.status).toBe(200);
    const fresh = reset.body.temporaryPassword as string;
    expect(fresh).not.toBe(professor.password);

    // The old password no longer works …
    const refused = await call(h, 'POST', '/api/v1/auth/login', {
      body: { email: 'professor@example.edu', password: professor.password },
    });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('AUTH_INVALID_CREDENTIALS');

    // … nor does the session that was open when it was reset …
    expect((await call(h, 'GET', '/api/v1/me', { token: theirToken })).status).toBe(401);

    // … and the new one does, with a forced change (R38).
    const token = await signIn(h, 'professor@example.edu', fresh);
    expect((await call(h, 'GET', '/api/v1/me', { token })).status).toBe(200);
  }, 90_000);
});

describe('who may do any of this (§10.2)', () => {
  it('refuses a professor every administration route with 403', async () => {
    const { h, adminToken } = await setUp();
    const professor = await addProfessor(h, adminToken);
    const token = await signIn(h, 'professor@example.edu', professor.password);
    await call(h, 'POST', '/api/v1/auth/change-password', {
      token,
      body: { currentPassword: professor.password, newPassword: 'a-professor-password' },
    });
    const theirs = await signIn(h, 'professor@example.edu', 'a-professor-password');

    for (const [method, route, body] of [
      ['GET', '/api/v1/admin/users', undefined],
      [
        'POST',
        '/api/v1/admin/users',
        { email: 'x@example.edu', displayName: 'X Y', roles: ['PROFESSOR'] },
      ],
      ['PATCH', `/api/v1/admin/users/${professor.id}`, { displayName: 'Renamed', version: 1 }],
      ['POST', `/api/v1/admin/users/${professor.id}/disable`, undefined],
      ['POST', `/api/v1/admin/users/${professor.id}/enable`, undefined],
      ['POST', `/api/v1/admin/users/${professor.id}/reset-password`, undefined],
    ] as const) {
      const answer = await call(h, method, route, { token: theirs, ...(body ? { body } : {}) });
      expect(answer.status, `${method} ${route}`).toBe(403);
      expect(answer.body.code, `${method} ${route}`).toBe('FORBIDDEN');
    }
  }, 90_000);

  it('refuses everything without a session at all', async () => {
    const { h } = await setUp();
    expect((await call(h, 'GET', '/api/v1/admin/users')).status).toBe(401);
  }, 60_000);
});

describe('the audit trail', () => {
  it('records one row per action, with no password in any of them', async () => {
    const { h, adminToken } = await setUp();
    const professor = await addProfessor(h, adminToken);
    await call(h, 'PATCH', `/api/v1/admin/users/${professor.id}`, {
      token: adminToken,
      body: { displayName: 'Renamed', version: professor.version },
    });
    await call(h, 'POST', `/api/v1/admin/users/${professor.id}/disable`, { token: adminToken });
    await call(h, 'POST', `/api/v1/admin/users/${professor.id}/enable`, { token: adminToken });
    const reset = await call(h, 'POST', `/api/v1/admin/users/${professor.id}/reset-password`, {
      token: adminToken,
    });

    const rows = h.database.db.raw.prepare('select action, diff_json from audit_log').all() as {
      action: string;
      diff_json: string | null;
    }[];
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('user.created');
    expect(actions).toContain('user.updated');
    expect(actions).toContain('user.disabled');
    expect(actions).toContain('user.enabled');
    expect(actions).toContain('user.password.reset');

    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(professor.password);
    expect(blob).not.toContain(reset.body.temporaryPassword);
    expect(blob).not.toContain(ADMIN_PASSWORD);
    expect(h.audit.verifyChain().ok).toBe(true);
  }, 90_000);
});
