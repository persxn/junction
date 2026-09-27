import { afterEach, describe, expect, it } from 'vitest';

import {
  addProfessor,
  ADMIN_PASSWORD,
  call,
  closeInstallation,
  setUp,
  signIn,
} from '../testing/admin-users.js';

/**
 * Who may administer accounts, and what the audit trail records (§10.2, D-24).
 *
 * Split out of `admin-users.test.ts` in pre-M2a so the Argon2id cost of these
 * cases runs beside the others rather than after them (ruling R89).
 */

afterEach(closeInstallation);

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
