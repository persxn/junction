import { ProblemDetails } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { call, signIn, startAuthTestServer, type AuthTestServer } from '../testing/auth-server.js';

/**
 * The API surface: §10.3's "everything except /health and /auth/login needs a
 * session", ruling R38's forced-password-change gate, and the problem+json shape
 * of a refusal. The rules themselves are tested in the service; this is about
 * what reaches the wire.
 */

const EMAIL = 'professor@example.edu';
const PASSWORD = 'correct horse battery staple';

let harness: AuthTestServer | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function withUser(
  seed: { mustChangePassword?: boolean; roles?: readonly ('ADMINISTRATOR' | 'PROFESSOR')[] } = {},
): Promise<AuthTestServer> {
  harness = await startAuthTestServer();
  await harness.auth.seed({ email: EMAIL, password: PASSWORD, ...seed });
  return harness;
}

async function problem(response: Response): Promise<ProblemDetails> {
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  return ProblemDetails.parse(await response.json());
}

describe('POST /auth/login', () => {
  it('works without a session and returns the token and the /me body', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      user: { email: string };
      roles: string[];
      permissions: { action: string }[];
      session: { autoLockMinutes: number };
    };
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user.email).toBe(EMAIL);
    expect(body.roles).toStrictEqual(['PROFESSOR']);
    expect(body.permissions.length).toBeGreaterThan(0);
    expect(body.session.autoLockMinutes).toBe(15);
  });

  it('refuses a wrong password as problem+json with the AUTH_ code', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/auth/login', {
      body: { email: EMAIL, password: 'wrong' },
    });
    expect(response.status).toBe(401);
    const body = await problem(response);
    expect(body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(body.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('validates the body before it reaches the service', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/auth/login', { body: { email: 'nope' } });
    expect(response.status).toBe(400);
    expect((await problem(response)).code).toBe('VALIDATION_FAILED');
  });

  it('still needs the client secret (§10.3)', async () => {
    const h = await withUser();
    const response = await fetch(`${h.server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(response.status).toBe(401);
    expect((await problem(response)).code).toBe('UNAUTHORIZED');
  });
});

describe('the session gate (§10.3)', () => {
  it.each(['/api/v1/me', '/api/v1/me/permissions', '/api/v1/stream'])(
    '%s refuses a request with no token',
    async (path) => {
      const h = await withUser();
      const response = await call(h, path);
      expect(response.status).toBe(401);
      expect((await problem(response)).code).toBe('UNAUTHORIZED');
    },
  );

  it('refuses a token it has never issued, with the session code', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/me', { token: 'a'.repeat(64) });
    expect(response.status).toBe(401);
    expect((await problem(response)).code).toBe('AUTH_SESSION_EXPIRED');
  });

  it('lets /health and /system/client-log through without one', async () => {
    const h = await withUser();
    expect((await call(h, '/api/v1/health')).status).toBe(200);
    const logged = await call(h, '/api/v1/system/client-log', {
      body: { level: 'error', message: 'the renderer threw' },
    });
    expect(logged.status).toBe(202);
  });

  it('puts CORS headers on a 401 so the UI can read it (ruling R18)', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/me', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('GET /me', () => {
  it('describes the signed-in user', async () => {
    const h = await withUser();
    const token = await signIn(h, EMAIL, PASSWORD);
    const body = (await (await call(h, '/api/v1/me', { token })).json()) as {
      user: { email: string; mustChangePassword: boolean };
      permissions: { action: string; rule: string }[];
    };
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.mustChangePassword).toBe(false);
    expect(body.permissions.some((entry) => entry.action === 'team.edit')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('gives an admin more permissions than a professor', async () => {
    const h = await withUser();
    await h.auth.seed({ email: 'admin@example.edu', password: PASSWORD, roles: ['ADMINISTRATOR'] });

    const professor = (await (
      await call(h, '/api/v1/me/permissions', { token: await signIn(h, EMAIL, PASSWORD) })
    ).json()) as { permissions: { action: string }[] };
    const admin = (await (
      await call(h, '/api/v1/me/permissions', {
        token: await signIn(h, 'admin@example.edu', PASSWORD),
      })
    ).json()) as { permissions: { action: string }[] };

    expect(admin.permissions.length).toBeGreaterThan(professor.permissions.length);
    expect(admin.permissions.map((entry) => entry.action)).toContain('user.manage');
    expect(professor.permissions.map((entry) => entry.action)).not.toContain('user.manage');
  });
});

describe('forced password change (ruling R38)', () => {
  it('lets login succeed and then blocks everything but the three routes', async () => {
    const h = await withUser({ mustChangePassword: true });
    const token = await signIn(h, EMAIL, PASSWORD);

    // /me is allowed, so the UI can find out which screen to show.
    const me = await call(h, '/api/v1/me', { token });
    expect(me.status).toBe(200);

    const blocked = await call(h, '/api/v1/me/permissions', { token });
    expect(blocked.status).toBe(403);
    expect((await problem(blocked)).code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');

    const streamBlocked = await call(h, '/api/v1/stream', { token });
    expect(streamBlocked.status).toBe(403);
  });

  it('opens everything once the password has been changed', async () => {
    const h = await withUser({ mustChangePassword: true });
    const token = await signIn(h, EMAIL, PASSWORD);

    const changed = await call(h, '/api/v1/auth/change-password', {
      token,
      body: { currentPassword: PASSWORD, newPassword: 'a-much-longer-password' },
    });
    expect(changed.status).toBe(200);
    expect((await call(h, '/api/v1/me/permissions', { token })).status).toBe(200);
  });
});

describe('logout and unlock', () => {
  it('ends the session', async () => {
    const h = await withUser();
    const token = await signIn(h, EMAIL, PASSWORD);
    expect((await call(h, '/api/v1/auth/logout', { token, method: 'POST' })).status).toBe(200);

    const after = await call(h, '/api/v1/me', { token });
    expect(after.status).toBe(401);
    expect((await problem(after)).code).toBe('AUTH_SESSION_EXPIRED');
  });

  it('unlocks with the same token (ruling R37)', async () => {
    const h = await withUser();
    const token = await signIn(h, EMAIL, PASSWORD);

    const response = await call(h, '/api/v1/auth/unlock', { token, body: { password: PASSWORD } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: { idleExpiresAt: string } | null };
    expect(body.session?.idleExpiresAt).toBeTruthy();
    // The token the UI holds is still the one that works.
    expect((await call(h, '/api/v1/me', { token })).status).toBe(200);
  });

  it('refuses to unlock with the wrong password', async () => {
    const h = await withUser();
    const token = await signIn(h, EMAIL, PASSWORD);
    const response = await call(h, '/api/v1/auth/unlock', { token, body: { password: 'no' } });
    expect(response.status).toBe(401);
    expect((await problem(response)).code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});

describe('the audit trail (the §19 acceptance criterion)', () => {
  it('records every auth action, and never a password or a token', async () => {
    const h = await withUser();
    await call(h, '/api/v1/auth/login', { body: { email: EMAIL, password: 'wrong' } });
    const token = await signIn(h, EMAIL, PASSWORD);
    await call(h, '/api/v1/auth/unlock', { token, body: { password: PASSWORD } });
    await call(h, '/api/v1/auth/change-password', {
      token,
      body: { currentPassword: PASSWORD, newPassword: 'a-much-longer-password' },
    });
    await call(h, '/api/v1/auth/logout', { token, method: 'POST' });

    const actions = h.auth.audit.all().map((row) => row.action);
    expect(actions).toStrictEqual([
      'auth.login.failed',
      'auth.login.succeeded',
      'auth.unlock',
      'auth.password.changed',
      'auth.logout',
    ]);

    const serialized = JSON.stringify(h.auth.audit.all());
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('a-much-longer-password');
    expect(serialized).not.toContain(token);
    expect(h.auth.audit.verifyChain().ok).toBe(true);
  });

  it('carries the request id, so a row can be matched to a log line', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/auth/login', {
      body: { email: EMAIL, password: PASSWORD },
    });
    const requestId = response.headers.get('x-request-id');
    expect(h.auth.audit.all().at(-1)?.requestId).toBe(requestId);
  });

  it('records a failed login without a user id when the account does not exist', async () => {
    const h = await withUser();
    await call(h, '/api/v1/auth/login', { body: { email: 'nobody@example.edu', password: 'x' } });
    const row = h.auth.audit.all().at(-1);
    expect(row?.action).toBe('auth.login.failed');
    expect(row?.actorUserId).toBeNull();
    expect(row?.summary).toContain('nobody@example.edu');
  });
});

describe('POST /system/client-log (ruling A19)', () => {
  it('refuses more than thirty entries a minute', async () => {
    const h = await withUser();
    let lastStatus = 0;
    for (let index = 0; index < 31; index += 1) {
      lastStatus = (
        await call(h, '/api/v1/system/client-log', { body: { message: `line ${String(index)}` } })
      ).status;
    }
    expect(lastStatus).toBe(429);
  });

  it('refuses a message longer than the schema allows', async () => {
    const h = await withUser();
    const response = await call(h, '/api/v1/system/client-log', {
      body: { message: 'x'.repeat(2_001) },
    });
    expect(response.status).toBe(400);
  });
});
