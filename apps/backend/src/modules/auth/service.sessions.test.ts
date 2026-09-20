import { describe, expect, it } from 'vitest';

import type { AppError } from '../../platform/errors.js';

import {
  codeOf,
  failure,
  seedingHarness,
  TestClock,
  TEST_EMAIL as EMAIL,
  TEST_PASSWORD as PASSWORD,
  type AuthHarness,
} from '../../testing/auth.js';
import { ABSOLUTE_SESSION_MS, hashToken, SESSION_REFRESH_INTERVAL_MS } from './tokens.js';

/**
 * What a session does once it exists: rulings R33, R37 and R38. Signing in, and
 * being refused, is `service.test.ts`.
 */

const withUser = seedingHarness();

describe('sessions (ruling R33)', () => {
  async function signIn(h: AuthHarness): Promise<string> {
    const { token } = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });
    return token;
  }

  it('resolves a token to the signed-in user', async () => {
    const h = await withUser();
    const token = await signIn(h);
    expect(h.service.authenticate(token).user.email).toBe(EMAIL);
  });

  it('refuses a token it has never seen', async () => {
    const h = await withUser();
    expect(() => h.service.authenticate('a'.repeat(64))).toThrow(/no longer valid/);
  });

  it('expires after the idle window', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    const token = await signIn(h);

    clock.advanceMinutes(h.service.autoLockMinutes());
    try {
      h.service.authenticate(token);
      throw new Error('expected the session to have expired');
    } catch (error) {
      expect(codeOf(error)).toBe('AUTH_SESSION_EXPIRED');
      expect((error as AppError).detail).toMatch(/away for a while/);
    }
  });

  it('expires 12 hours after sign-in however busy the client is', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    const startedAt = clock.now();
    const token = await signIn(h);

    // Touch it every ten minutes — inside the 15-minute idle window every time,
    // so only the absolute expiry can ever end it.
    let ended: unknown;
    for (let step = 0; step < 90 && ended === undefined; step += 1) {
      clock.advanceMinutes(10);
      try {
        h.service.authenticate(token);
      } catch (error) {
        ended = error;
      }
    }
    expect(codeOf(ended)).toBe('AUTH_SESSION_EXPIRED');
    expect((ended as AppError).detail).toMatch(/12 hours/);
    // 12 h after sign-in, to the ten-minute step the loop takes.
    expect(clock.now()).toBe(startedAt + ABSOLUTE_SESSION_MS);
  });

  it('moves the idle window forward at most once a minute', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    const token = await signIn(h);
    const first = h.repository.findSessionByTokenHash(hashToken(token));

    clock.advanceMs(SESSION_REFRESH_INTERVAL_MS - 1);
    h.service.authenticate(token);
    expect(h.repository.findSessionByTokenHash(hashToken(token))?.lastSeenAt).toBe(
      first?.lastSeenAt,
    );

    clock.advanceMs(2);
    h.service.authenticate(token);
    const refreshed = h.repository.findSessionByTokenHash(hashToken(token));
    expect(refreshed?.lastSeenAt).toBe(clock.now());
    expect(refreshed?.idleExpiresAt).toBe(clock.now() + h.service.autoLockMinutes() * 60_000);
  });

  it('never pushes the idle window past the absolute one', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    // An auto-lock longer than a session's whole life; the refresh must clamp.
    h.settings.set('auth.autoLockMinutes', 24 * 60);
    const token = await signIn(h);

    clock.advanceMs(SESSION_REFRESH_INTERVAL_MS + 1);
    const refreshed = h.service.authenticate(token);
    expect(refreshed.idleExpiresAt).toBe(refreshed.absoluteExpiresAt);
  });

  it('stops working after logout', async () => {
    const h = await withUser();
    const token = await signIn(h);
    h.service.logout(h.service.authenticate(token));
    expect(() => h.service.authenticate(token)).toThrow(/signed out/);
  });

  it('stops working when the account is disabled mid-session', async () => {
    const h = await withUser();
    const token = await signIn(h);
    const user = h.repository.findUserByEmail(EMAIL);
    h.database.db.raw.prepare('UPDATE users SET status = ? WHERE id = ?').run('DISABLED', user?.id);
    try {
      h.service.authenticate(token);
      throw new Error('expected the session to be refused');
    } catch (error) {
      expect(codeOf(error)).toBe('AUTH_ACCOUNT_DISABLED');
    }
  });
});

describe('unlock (ruling R37)', () => {
  it('extends the same session rather than minting a new token', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    const { token, session } = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });

    clock.advanceMinutes(5);
    const expiry = await h.service.unlock(h.service.authenticate(token), PASSWORD);

    // Same token, same session row, later idle expiry.
    expect(h.service.authenticate(token).id).toBe(session.id);
    expect(new Date(expiry.idleExpiresAt).getTime()).toBe(
      clock.now() + h.service.autoLockMinutes() * 60_000,
    );
  });

  it('refuses the wrong password and leaves the session where it was', async () => {
    const clock = new TestClock();
    const h = await withUser({ clock });
    const { token } = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });

    clock.advanceMinutes(5);
    // Reading the session is itself a touch; capture the window after that, so
    // the assertion is about `unlock` and nothing else.
    const session = h.service.authenticate(token);
    const before = h.repository.findSessionByTokenHash(hashToken(token))?.idleExpiresAt;

    const error = await failure(h.service.unlock(session, 'wrong'));
    expect(codeOf(error)).toBe('AUTH_INVALID_CREDENTIALS');
    expect(h.repository.findSessionByTokenHash(hashToken(token))?.idleExpiresAt).toBe(before);
  });
});

describe('changing a password', () => {
  it('needs the current one', async () => {
    const h = await withUser();
    const { token } = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });
    const error = await failure(
      h.service.changePassword(h.service.authenticate(token), 'not-it', 'a-new-long-password'),
    );
    expect(codeOf(error)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('clears must_change_password and lets the new password sign in', async () => {
    const h = await withUser({}, { mustChangePassword: true });
    const { token } = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });
    expect(h.service.authenticate(token).user.mustChangePassword).toBe(true);

    await h.service.changePassword(
      h.service.authenticate(token),
      PASSWORD,
      'a-new-long-password-1',
    );
    expect(h.repository.findUserByEmail(EMAIL)?.mustChangePassword).toBe(false);
    await expect(
      h.service.login({ email: EMAIL, password: 'a-new-long-password-1', clientKind: 'DESKTOP' }),
    ).resolves.toBeDefined();
  });

  it('ends every other session but keeps the one doing the changing', async () => {
    const h = await withUser();
    const first = await h.service.login({
      email: EMAIL,
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });
    const second = await h.service.login({ email: EMAIL, password: PASSWORD, clientKind: 'WEB' });

    await h.service.changePassword(
      h.service.authenticate(second.token),
      PASSWORD,
      'a-new-long-password-2',
    );

    expect(() => h.service.authenticate(first.token)).toThrow();
    expect(h.service.authenticate(second.token).user.email).toBe(EMAIL);
  });
});
