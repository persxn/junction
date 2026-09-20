import { describe, expect, it } from 'vitest';

import {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PermissionsResponse,
  SessionExpiry,
  SessionResponse,
  StreamEvent,
  UnlockRequest,
} from './auth.js';
import { AUTH_ERROR_CODES, ErrorCode } from './errors.js';

const USER = {
  id: '0192f0c1-0000-7000-8000-000000000001',
  email: 'professor@example.edu',
  displayName: 'A. Professor',
  departmentId: '0192f0c1-0000-7000-8000-000000000002',
  status: 'ACTIVE',
  mustChangePassword: false,
};

const SESSION = {
  idleExpiresAt: '2026-09-20T12:15:00.000Z',
  absoluteExpiresAt: '2026-09-21T00:00:00.000Z',
  autoLockMinutes: 15,
};

const ME = {
  user: USER,
  roles: ['PROFESSOR'],
  permissions: [{ action: 'team.edit', rule: 'TEAM_MENTOR' }],
  session: SESSION,
};

describe('LoginRequest', () => {
  it('accepts an email and a password, defaulting the client kind', () => {
    const parsed = LoginRequest.parse({ email: 'a@b.edu', password: 'hunter2' });
    expect(parsed.clientKind).toBe('DESKTOP');
  });

  it('refuses something that is not an email', () => {
    expect(() => LoginRequest.parse({ email: 'not-an-email', password: 'x' })).toThrow();
  });

  it('does not impose the new-password minimum on an existing one', () => {
    // An account created before a stricter policy must still be able to sign in
    // — and then be forced to change it.
    expect(() => LoginRequest.parse({ email: 'a@b.edu', password: 'short' })).not.toThrow();
  });

  it('bounds the password so Argon2id cannot be handed a megabyte', () => {
    expect(() =>
      LoginRequest.parse({ email: 'a@b.edu', password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }),
    ).toThrow();
  });

  it('refuses an unknown client kind', () => {
    expect(() =>
      LoginRequest.parse({ email: 'a@b.edu', password: 'x', clientKind: 'PHONE' }),
    ).toThrow();
  });
});

describe('ChangePasswordRequest and UnlockRequest', () => {
  it('requires the current password as well as the new one', () => {
    expect(() => ChangePasswordRequest.parse({ newPassword: 'a'.repeat(20) })).toThrow();
  });

  it('holds the new password to the minimum length', () => {
    expect(() =>
      ChangePasswordRequest.parse({
        currentPassword: 'old',
        newPassword: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
      }),
    ).toThrow();
    expect(
      ChangePasswordRequest.parse({
        currentPassword: 'old',
        newPassword: 'a'.repeat(PASSWORD_MIN_LENGTH),
      }).newPassword,
    ).toHaveLength(PASSWORD_MIN_LENGTH);
  });

  it('asks unlock for a password and nothing else', () => {
    expect(UnlockRequest.parse({ password: 'hunter2' })).toStrictEqual({ password: 'hunter2' });
    expect(() => UnlockRequest.parse({ password: '' })).toThrow();
  });
});

describe('AuthUser', () => {
  it('parses a user with no department', () => {
    expect(AuthUser.parse({ ...USER, departmentId: null }).departmentId).toBeNull();
  });

  it('refuses an unknown status', () => {
    expect(() => AuthUser.parse({ ...USER, status: 'PENDING' })).toThrow();
  });

  it('carries no password field of any kind', () => {
    const parsed = AuthUser.parse({ ...USER, passwordHash: 'leaked' }) as Record<string, unknown>;
    expect(parsed.passwordHash).toBeUndefined();
  });
});

describe('MeResponse and LoginResponse', () => {
  it('parses the whole /me body', () => {
    expect(MeResponse.parse(ME).roles).toStrictEqual(['PROFESSOR']);
  });

  it('refuses a permission entry that is not in the matrix', () => {
    expect(() =>
      MeResponse.parse({ ...ME, permissions: [{ action: 'team.explode', rule: 'ALWAYS' }] }),
    ).toThrow();
  });

  it('is /me plus the token, which only login returns', () => {
    expect(() => LoginResponse.parse(ME)).toThrow();
    expect(LoginResponse.parse({ ...ME, token: 'opaque' }).token).toBe('opaque');
  });

  it('requires both expiries as offset-bearing ISO timestamps', () => {
    expect(() => SessionExpiry.parse({ ...SESSION, idleExpiresAt: '2026-09-20' })).toThrow();
    expect(() => SessionExpiry.parse({ ...SESSION, autoLockMinutes: 0 })).toThrow();
  });

  it('lets the session be null once it has been ended', () => {
    expect(SessionResponse.parse({ session: null }).session).toBeNull();
    expect(SessionResponse.parse({ session: SESSION }).session).not.toBeNull();
  });

  it('parses the permissions-only body', () => {
    expect(PermissionsResponse.parse({ permissions: ME.permissions }).permissions).toHaveLength(1);
  });
});

describe('StreamEvent (ruling R36)', () => {
  it('parses an event with a monotonic id', () => {
    const event = StreamEvent.parse({
      id: 7,
      type: 'data.invalidated',
      payload: { domain: 'events' },
    });
    expect(event.id).toBe(7);
  });

  it('refuses id 0, so Last-Event-ID is never ambiguous', () => {
    expect(() => StreamEvent.parse({ id: 0, type: 'stream.ready', payload: {} })).toThrow();
  });

  it('refuses an unknown event type', () => {
    expect(() => StreamEvent.parse({ id: 1, type: 'gossip', payload: {} })).toThrow();
  });
});

describe('the AUTH error codes (ruling R12)', () => {
  it.each(AUTH_ERROR_CODES)('%s is part of the closed ErrorCode enum', (code) => {
    expect(() => ErrorCode.parse(code)).not.toThrow();
  });

  it('prefixes every one of them with its domain', () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(code.startsWith('AUTH_')).toBe(true);
    }
  });
});
