import { afterEach, describe, expect, it } from 'vitest';

import { addProfessor, call, closeInstallation, setUp, signIn } from '../testing/admin-users.js';

/**
 * Editing an account and resetting its password (§10.2 `user.manage`, R38).
 *
 * Split out of `admin-users.test.ts` in pre-M2a so the Argon2id cost of these
 * cases runs beside the others rather than after them (ruling R89).
 */

afterEach(closeInstallation);

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
