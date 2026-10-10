import { afterEach, describe, expect, it } from 'vitest';

import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * The student edition over a real socket (WP-34, rulings R130–R135): setting up
 * as "Myself" or "An institution", the password-less guest, "Create my profile",
 * and what a department install refuses.
 */

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
  body?: unknown,
  token?: string,
): Promise<Answer> {
  const response = await fetch(`${h.server.baseUrl}${route}`, {
    method,
    headers: {
      'X-CompIntel-Client': h.server.config.clientSecret,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as never) };
}

const MYSELF = {
  mode: 'STUDENT_INDIVIDUAL',
  displayName: 'Asha',
  home: { label: 'Kolkata, West Bengal', lat: 22.5726, lon: 88.3639 },
  scraperContactEmail: 'asha@example.com',
};
const INSTITUTION = {
  mode: 'STUDENT_INSTITUTION',
  organization: { name: 'Example Institute of Technology' },
  group: { name: 'Coding Club' },
  campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
  scraperContactEmail: 'club@example.edu',
};
const PROFILE = {
  displayName: 'Asha Rao',
  email: 'asha@example.com',
  password: 'asha-long-password',
};

async function guestToken(h: SetupTestServer): Promise<string> {
  const signed = await call(h, 'POST', '/api/v1/auth/guest');
  expect(signed.status).toBe(200);
  return signed.body.token as string;
}

const me = async (h: SetupTestServer, token: string): Promise<Record<string, unknown>> =>
  (await call(h, 'GET', '/api/v1/me', undefined, token)).body;

describe('Myself (R133)', () => {
  it('sets up with no password, opens as the guest, and claims in place', async () => {
    const h = (harness = await startSetupTestServer());
    expect((await call(h, 'POST', '/api/v1/setup/complete', MYSELF)).status).toBe(200);
    const status = await call(h, 'GET', '/api/v1/setup/status');
    expect(status.body).toMatchObject({ required: false, mode: 'STUDENT_INDIVIDUAL' });
    expect((await call(h, 'GET', '/api/v1/auth/guest')).body).toStrictEqual({
      available: true,
      mode: 'STUDENT_INDIVIDUAL',
      automatic: true,
    });

    const guest = await guestToken(h);
    const before = await me(h, guest);
    expect(before).toMatchObject({
      mode: 'STUDENT_INDIVIDUAL',
      guestEnabled: true,
      roles: ['ADMINISTRATOR', 'STUDENT'],
      user: { isGuest: true, displayName: 'Asha' },
    });
    const session = before.session as Record<string, unknown>;
    expect(session.autoLockMinutes).toBeNull();
    expect(session.idleExpiresAt).toBe(session.absoluteExpiresAt);

    // A teammate with no roll number is fine on a student install (R135).
    const created = await call(
      h,
      'POST',
      '/api/v1/students',
      { fullName: 'Ravi', program: 'BTECH' },
      guest,
    );
    expect(created.status).toBe(200);

    // The guest has no password to use anywhere (R132).
    expect(
      (
        await call(h, 'POST', '/api/v1/auth/login', {
          email: 'guest@junction.invalid',
          password: 'x',
        })
      ).body.code,
    ).toBe('AUTH_GUEST_HAS_NO_PASSWORD');
    expect((await call(h, 'POST', '/api/v1/auth/unlock', { password: 'x' }, guest)).body.code).toBe(
      'AUTH_GUEST_HAS_NO_PASSWORD',
    );

    const claimed = await call(h, 'POST', '/api/v1/me/profile', PROFILE, guest);
    expect(claimed.status).toBe(200);
    const profile = claimed.body.token as string;
    const after = await me(h, profile);
    expect(after).toMatchObject({
      user: { id: (before.user as { id: string }).id, isGuest: false, email: 'asha@example.com' },
      guestEnabled: false,
    });
    expect((after.session as Record<string, unknown>).autoLockMinutes).toBe(15);
    // Same account, so the teammate it created is still its own.
    const list = await call(h, 'GET', '/api/v1/students', undefined, profile);
    expect((list.body.items as unknown[]).length).toBe(1);

    expect((await call(h, 'GET', '/api/v1/me', undefined, guest)).status).toBe(401);
    expect((await call(h, 'POST', '/api/v1/auth/guest')).body.code).toBe('AUTH_GUEST_UNAVAILABLE');
    expect(
      (
        await call(
          h,
          'POST',
          '/api/v1/admin/users',
          { email: 'b@example.com', displayName: 'Bee', roles: ['STUDENT'] },
          profile,
        )
      ).body.code,
    ).toBe('AUTH_SINGLE_PROFILE_INSTALL');
    expect(
      (
        await call(h, 'POST', '/api/v1/auth/login', {
          email: PROFILE.email,
          password: PROFILE.password,
        })
      ).status,
    ).toBe(200);
  });

  it('refuses a student request that carries an administrator or a passphrase', async () => {
    const h = (harness = await startSetupTestServer());
    const answer = await call(h, 'POST', '/api/v1/setup/complete', {
      ...MYSELF,
      admin: { email: 'a@example.com', displayName: 'A', password: 'long-enough-pass' },
      backupPassphrase: 'a-long-passphrase',
    });
    expect(answer.status).toBe(400);
    expect((await call(h, 'GET', '/api/v1/setup/status')).body.required).toBe(true);
  });
});

describe('An institution (R134)', () => {
  it('makes the first profile the lead, moves what Guest made, and keeps walk-ins', async () => {
    const h = (harness = await startSetupTestServer());
    expect((await call(h, 'POST', '/api/v1/setup/complete', INSTITUTION)).status).toBe(200);
    expect((await call(h, 'GET', '/api/v1/auth/guest')).body).toMatchObject({
      available: true,
      automatic: false,
    });

    const guest = await guestToken(h);
    expect(
      (await call(h, 'POST', '/api/v1/students', { fullName: 'Ravi', program: 'BTECH' }, guest))
        .status,
    ).toBe(200);
    const lead = await call(
      h,
      'POST',
      '/api/v1/me/profile',
      { ...PROFILE, takeGuestData: true },
      guest,
    );
    expect(lead.status).toBe(200);
    expect(lead.body.roles).toStrictEqual(['ADMINISTRATOR', 'STUDENT']);
    // The guest's mentorship moved with them, so Ravi is "mine" for the lead.
    const mine = await call(h, 'GET', '/api/v1/students', undefined, lead.body.token as string);
    expect((mine.body.items as { isMine: boolean }[])[0]?.isMine).toBe(true);

    // The guest is still there for walk-ins, now as a plain student.
    const second = await guestToken(h);
    expect((await me(h, second)).roles).toStrictEqual(['STUDENT']);
    const member = await call(
      h,
      'POST',
      '/api/v1/me/profile',
      { displayName: 'Bea', email: 'bea@example.com', password: 'bea-long-password' },
      second,
    );
    expect(member.body.roles).toStrictEqual(['STUDENT']);

    const leadToken = lead.body.token as string;
    expect(
      (
        await call(
          h,
          'POST',
          '/api/v1/admin/users',
          { email: 'p@example.edu', displayName: 'Prof', roles: ['PROFESSOR'] },
          leadToken,
        )
      ).body.code,
    ).toBe('AUTH_ROLE_NOT_FOR_MODE');
    expect(
      (await call(h, 'PUT', '/api/v1/admin/guest', { enabled: false }, leadToken)).body,
    ).toMatchObject({ available: false });
    expect((await call(h, 'POST', '/api/v1/auth/guest')).status).toBe(404);
    expect(
      (await call(h, 'PUT', '/api/v1/admin/guest', { enabled: false }, member.body.token as string))
        .status,
    ).toBe(403);
  });

  it('names exactly one lead when two guests claim at once', async () => {
    const h = (harness = await startSetupTestServer());
    await call(h, 'POST', '/api/v1/setup/complete', INSTITUTION);
    const [a, b] = [await guestToken(h), await guestToken(h)];
    const answers = await Promise.all([
      call(h, 'POST', '/api/v1/me/profile', { ...PROFILE, email: 'a@example.com' }, a),
      call(h, 'POST', '/api/v1/me/profile', { ...PROFILE, email: 'b@example.com' }, b),
    ]);
    const leads = answers.filter((answer) =>
      (answer.body.roles as string[]).includes('ADMINISTRATOR'),
    );
    expect(leads).toHaveLength(1);
  });
});

describe('a department install (R130, R131)', () => {
  it('offers no guest, refuses STUDENT accounts and still needs roll numbers', async () => {
    const h = (harness = await startSetupTestServer());
    expect((await call(h, 'GET', '/api/v1/setup/places?q=kol')).status).toBe(200);
    await call(h, 'POST', '/api/v1/setup/complete', {
      organization: { name: 'Example Institute of Technology' },
      department: { name: 'CSE' },
      campus: { name: 'Main', lat: 10, lon: 78 },
      admin: { email: 'admin@example.edu', displayName: 'Admin', password: 'admin-long-password' },
      scraperContactEmail: 'scraper@example.edu',
      backupDir: h.backupDir,
      backupPassphrase: 'a-long-backup-passphrase',
    });
    expect((await call(h, 'GET', '/api/v1/setup/status')).body.mode).toBe('DEPARTMENT');
    expect((await call(h, 'GET', '/api/v1/auth/guest')).body).toMatchObject({ available: false });
    expect((await call(h, 'POST', '/api/v1/auth/guest')).status).toBe(404);
    expect((await call(h, 'GET', '/api/v1/setup/places?q=kol')).status).toBe(401);

    const login = await call(h, 'POST', '/api/v1/auth/login', {
      email: 'admin@example.edu',
      password: 'admin-long-password',
    });
    const token = login.body.token as string;
    expect(login.body.mode).toBe('DEPARTMENT');
    expect(
      (
        await call(
          h,
          'POST',
          '/api/v1/admin/users',
          { email: 's@example.edu', displayName: 'Stu', roles: ['STUDENT'] },
          token,
        )
      ).body.code,
    ).toBe('AUTH_ROLE_NOT_FOR_MODE');
    expect(
      (await call(h, 'POST', '/api/v1/students', { fullName: 'Ravi', program: 'BTECH' }, token))
        .body.code,
    ).toBe('STUDENT_UNIVERSITY_ID_REQUIRED');
  });
});
