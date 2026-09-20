import { describe, expect, it } from 'vitest';

import {
  codeOf,
  failure,
  seedingHarness,
  TestClock,
  TEST_EMAIL as EMAIL,
  TEST_PASSWORD as PASSWORD,
  type AuthHarness,
} from '../../testing/auth.js';
import { LOCKOUT_LADDER_MINUTES } from '../../domain/lockout.js';
import { LoginRateLimiter } from './throttle.js';
import { ABSOLUTE_SESSION_MS, hashToken } from './tokens.js';

/**
 * Signing in: §4.12 and ruling R34. Nothing here waits — the harness owns the
 * clock, so the lockout ladder is exercised in full rather than sampled.
 *
 * What happens once a session exists is `service.sessions.test.ts`.
 */

const withUser = seedingHarness();

describe('login', () => {
  it('signs a user in and hands back a token that is not stored', async () => {
    const h = await withUser();
    const result = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.session.user.email).toBe(EMAIL);
    expect(result.session.user.roles).toStrictEqual(['PROFESSOR']);

    // Only the hash is on disk.
    const stored = h.repository.findSessionByTokenHash(hashToken(result.token));
    expect(stored?.tokenHash).toBe(hashToken(result.token));
    expect(stored?.tokenHash).not.toBe(result.token);
  });

  it('matches the email case-insensitively', async () => {
    const h = await withUser();
    await expect(
      h.service.login({
        email: 'Professor@Example.EDU',
        password: PASSWORD,
        clientKind: 'DESKTOP',
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a wrong password without saying whether the account exists', async () => {
    const h = await withUser();
    const wrong = await failure(
      h.service.login({ email: EMAIL, password: 'nope', clientKind: 'DESKTOP' }),
    );
    const unknown = await failure(
      h.service.login({ email: 'nobody@example.edu', password: PASSWORD, clientKind: 'DESKTOP' }),
    );
    expect(codeOf(wrong)).toBe('AUTH_INVALID_CREDENTIALS');
    expect(codeOf(unknown)).toBe('AUTH_INVALID_CREDENTIALS');
    expect(wrong.title).toBe(unknown.title);
  });

  it('refuses a disabled account with its own code', async () => {
    const h = await withUser();
    const user = h.repository.findUserByEmail(EMAIL);
    h.database.db.raw.prepare('UPDATE users SET status = ? WHERE id = ?').run('DISABLED', user?.id);

    const error = await failure(
      h.service.login({ email: EMAIL, password: PASSWORD, clientKind: 'DESKTOP' }),
    );
    expect(codeOf(error)).toBe('AUTH_ACCOUNT_DISABLED');
  });

  it('sets the two expiries from the settings and R33', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    h.settings.set('auth.autoLockMinutes', 20);

    const { session } = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });
    expect(session.idleExpiresAt).toBe(clock.nowMs() + 20 * 60_000);
    expect(session.absoluteExpiresAt).toBe(clock.nowMs() + ABSOLUTE_SESSION_MS);
  });
});

describe('the lockout ladder (ruling R34)', () => {
  async function failTimes(h: AuthHarness, times: number): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      await failure(h.service.login({ email: EMAIL, password: 'wrong', clientKind: 'DESKTOP' }));
    }
  }

  it('locks for 5 minutes after 5 consecutive failures', async () => {
    const clock = new TestClock();
    // A window wide enough that the process-wide limit never interferes here.
    const h = await withUser({ clock, rateLimiter: new LoginRateLimiter({ limit: 1_000 }) });

    await failTimes(h, 4);
    expect(h.repository.findUserByEmail(EMAIL)?.lockedUntil).toBeNull();

    await failTimes(h, 1);
    const locked = h.repository.findUserByEmail(EMAIL);
    expect(locked?.failedLoginCount).toBe(5);
    expect(locked?.lockedUntil).toBe(clock.nowMs() + 5 * 60_000);
  });

  it('refuses even a correct password while locked, and does not touch the counter', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock, rateLimiter: new LoginRateLimiter({ limit: 1_000 }) });
    await failTimes(h, 5);

    const error = await failure(
      h.service.login({ email: EMAIL, password: PASSWORD, clientKind: 'DESKTOP' }),
    );
    expect(codeOf(error)).toBe('AUTH_ACCOUNT_LOCKED');
    expect(h.repository.findUserByEmail(EMAIL)?.failedLoginCount).toBe(5);
  });

  it('lets the right password through once the lock has lapsed', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock, rateLimiter: new LoginRateLimiter({ limit: 1_000 }) });
    await failTimes(h, 5);

    clock.advanceMinutes(5);
    await expect(
      h.service.login({ email: EMAIL, password: PASSWORD, clientKind: 'DESKTOP' }),
    ).resolves.toBeDefined();
    // A success clears both.
    const user = h.repository.findUserByEmail(EMAIL);
    expect(user?.failedLoginCount).toBe(0);
    expect(user?.lockedUntil).toBeNull();
  });

  it('climbs 5 → 10 → 20 → 40 → 60 and then stays at 60', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock, rateLimiter: new LoginRateLimiter({ limit: 1_000 }) });

    const seen: number[] = [];
    for (let lockout = 0; lockout < 6; lockout += 1) {
      await failTimes(h, 5);
      const lockedUntil = h.repository.findUserByEmail(EMAIL)?.lockedUntil ?? 0;
      seen.push(Math.round((lockedUntil - clock.nowMs()) / 60_000));
      // Wait it out so the next five failures are actually recorded.
      clock.advanceMs(lockedUntil - clock.nowMs() + 1);
    }
    expect(seen).toStrictEqual([...LOCKOUT_LADDER_MINUTES, 60]);
  });
});

describe('the process-wide limit (ruling R34)', () => {
  it('refuses the 11th attempt in a minute, whoever it is for', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });

    for (let index = 0; index < 10; index += 1) {
      await failure(
        h.service.login({
          email: `nobody${String(index)}@x.edu`,
          password: 'x',
          clientKind: 'DESKTOP',
        }),
      );
    }
    const error = await failure(
      h.service.login({ email: EMAIL, password: PASSWORD, clientKind: 'DESKTOP' }),
    );
    expect(codeOf(error)).toBe('RATE_LIMITED');
    expect(error.status).toBe(429);
  });

  it('lets attempts through again once the window has slid', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    for (let index = 0; index < 10; index += 1) {
      await failure(
        h.service.login({ email: 'nobody@x.edu', password: 'x', clientKind: 'DESKTOP' }),
      );
    }
    clock.advanceMs(60_001);
    await expect(
      h.service.login({ email: EMAIL, password: PASSWORD, clientKind: 'DESKTOP' }),
    ).resolves.toBeDefined();
  });
});
