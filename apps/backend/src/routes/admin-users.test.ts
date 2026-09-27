import { afterEach, describe, expect, it } from 'vitest';

import { addProfessor, call, closeInstallation, setUp, signIn } from '../testing/admin-users.js';

/**
 * Creating, disabling and enabling an account (§10.2 `user.manage`).
 *
 * Every case starts from a completed setup, because that is the only way an
 * administrator exists at all — which is itself the point of ruling R39. The
 * shared harness is `testing/admin-users.ts`; editing and access live in
 * `admin-users-edit.test.ts` and `admin-users-access.test.ts`.
 */

afterEach(closeInstallation);

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
