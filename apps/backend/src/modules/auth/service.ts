import type {
  AuthUser,
  ClientKind,
  LoginRequest,
  PermissionEntry,
  RoleKey,
  SessionExpiry,
  UserStatus,
} from '@compintel/contracts';
import { permissionsFor } from '@compintel/contracts';

import type { AuditLog } from '../../platform/audit.js';
import type { SettingsStore } from '../../platform/settings.js';
import {
  accountDisabled,
  accountLocked,
  invalidCredentials,
  sessionExpired,
  tooManyAttempts,
} from './errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { normalizeEmail, type AuthRepository } from './repository.js';
import { LoginRateLimiter, lockoutMinutesFor } from './throttle.js';
import {
  ABSOLUTE_SESSION_MS,
  generateSessionToken,
  hashToken,
  SESSION_REFRESH_INTERVAL_MS,
  type RandomBytes,
} from './tokens.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';

/**
 * The auth rules (ARCHITECTURE.md §4.12, §10.5, rulings R33, R34, R37, R38).
 *
 * Everything that decides something lives here; the routes only translate. Every
 * clock and every random source is injected, because the lockout ladder, the two
 * expiries and the 60-second refresh window are all *time* behaviour, and a test
 * that has to wait five real minutes is a test nobody runs.
 */

export interface Principal {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly departmentId: string | null;
  readonly status: UserStatus;
  readonly mustChangePassword: boolean;
  readonly roles: readonly RoleKey[];
}

export interface ActiveSession {
  readonly id: string;
  readonly user: Principal;
  readonly idleExpiresAt: number;
  readonly absoluteExpiresAt: number;
}

export interface LoginContext {
  readonly clientKind?: ClientKind;
  readonly clientLabel?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface LoginResult {
  /** The one time this ever exists outside the client's memory. */
  readonly token: string;
  readonly session: ActiveSession;
}

export interface AuthServiceDependencies {
  readonly repository: AuthRepository;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly clock?: Clock;
  readonly random?: RandomBytes;
  readonly rateLimiter?: LoginRateLimiter;
}

export class AuthService {
  readonly #repo: AuthRepository;
  readonly #settings: SettingsStore;
  readonly #audit: AuditLog;
  readonly #clock: Clock;
  readonly #random: RandomBytes | undefined;
  readonly #rateLimiter: LoginRateLimiter;

  constructor(dependencies: AuthServiceDependencies) {
    this.#repo = dependencies.repository;
    this.#settings = dependencies.settings;
    this.#audit = dependencies.audit;
    this.#clock = dependencies.clock ?? systemClock;
    this.#random = dependencies.random;
    this.#rateLimiter = dependencies.rateLimiter ?? new LoginRateLimiter({ clock: this.#clock });
  }

  /** Milliseconds since the epoch, the shape every timestamp column wants. */
  get #nowMs(): number {
    return nowMs(this.#clock);
  }

  /** Minutes of inactivity before the idle window lapses (`auth.autoLockMinutes`). */
  autoLockMinutes(): number {
    return this.#settings.get('auth.autoLockMinutes');
  }

  #principal(userId: string): Principal | undefined {
    const row = this.#repo.findUserById(userId);
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      departmentId: row.departmentId,
      status: row.status as UserStatus,
      mustChangePassword: row.mustChangePassword,
      roles: this.#repo.rolesOf(row.id),
    };
  }

  #issueSession(userId: string, context: LoginContext): LoginResult {
    const now = this.#nowMs;
    const token = generateSessionToken(this.#random);
    const row = this.#repo.createSession({
      userId,
      tokenHash: hashToken(token),
      idleExpiresAt: now + this.autoLockMinutes() * 60_000,
      absoluteExpiresAt: now + ABSOLUTE_SESSION_MS,
      clientKind: context.clientKind ?? 'DESKTOP',
      clientLabel: context.clientLabel,
    });
    const user = this.#principal(userId);
    if (user === undefined) {
      throw new Error(`user ${userId} vanished between authentication and session creation`);
    }
    return {
      token,
      session: {
        id: row.id,
        user,
        idleExpiresAt: row.idleExpiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
      },
    };
  }

  /**
   * §4.12's sign-in, in the order the checks have to happen: the process-wide
   * ceiling first (it costs nothing), then the account lock — which refuses even
   * a correct password and does *not* touch the counter (R34) — and only then
   * the password, which is the expensive part.
   */
  async login(request: LoginRequest, context: LoginContext = {}): Promise<LoginResult> {
    if (!this.#rateLimiter.tryAcquire()) {
      this.#auditFailure(null, normalizeEmail(request.email), 'rate limited', context);
      throw tooManyAttempts();
    }

    const now = this.#nowMs;
    const row = this.#repo.findUserByEmail(request.email);
    if (row === undefined) {
      // Still hash something, so "no such account" and "wrong password" take a
      // comparable amount of time and cannot be told apart by a stopwatch.
      await verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAA',
        request.password,
      );
      this.#auditFailure(null, normalizeEmail(request.email), 'no such account', context);
      throw invalidCredentials();
    }

    if (row.lockedUntil !== null && row.lockedUntil > now) {
      this.#auditFailure(row.id, row.email, 'account locked', context);
      throw accountLocked(new Date(row.lockedUntil));
    }
    if (row.status !== 'ACTIVE') {
      this.#auditFailure(row.id, row.email, 'account disabled', context);
      throw accountDisabled();
    }

    if (!(await verifyPassword(row.passwordHash, request.password))) {
      const failures = this.#repo.recordFailedLogin(row.id, undefined);
      const lockMinutes = lockoutMinutesFor(failures);
      if (lockMinutes !== undefined) {
        this.#repo.setLockedUntil(row.id, now + lockMinutes * 60_000);
      }
      this.#auditFailure(row.id, row.email, 'wrong password', context, {
        failedLoginCount: failures,
        ...(lockMinutes === undefined ? {} : { lockedForMinutes: lockMinutes }),
      });
      throw invalidCredentials();
    }

    this.#repo.recordSuccessfulLogin(row.id);
    const result = this.#issueSession(row.id, context);
    this.#audit.append({
      actorKind: 'USER',
      actorUserId: row.id,
      action: 'auth.login.succeeded',
      entityKind: 'session',
      entityId: result.session.id,
      summary: `${row.email} signed in`,
      diff: { clientKind: context.clientKind ?? 'DESKTOP' },
      requestId: context.requestId ?? null,
    });
    return result;
  }

  /** A failed attempt is audited, never with the password (R34). */
  #auditFailure(
    userId: string | null,
    email: string,
    reason: string,
    context: LoginContext,
    extra: Readonly<Record<string, unknown>> = {},
  ): void {
    this.#audit.append({
      actorKind: 'USER',
      actorUserId: userId,
      action: 'auth.login.failed',
      entityKind: 'user',
      entityId: userId ?? email,
      summary: `Sign-in refused for ${email}: ${reason}`,
      diff: { reason, ...extra },
      requestId: context.requestId ?? null,
    });
  }

  /**
   * Resolves a bearer token to a session, moving the idle window forward if the
   * last touch is more than a minute old (R33). Anything wrong with the session
   * — unknown, revoked, idle-expired, absolutely expired, or belonging to an
   * account that has since been disabled — is one 401 with a different sentence.
   */
  authenticate(token: string): ActiveSession {
    const now = this.#nowMs;
    const row = this.#repo.findSessionByTokenHash(hashToken(token));
    if (row === undefined) {
      throw sessionExpired('This sign-in is no longer valid.');
    }
    if (row.revokedAt !== null) {
      throw sessionExpired('You signed out on this device.');
    }
    if (row.absoluteExpiresAt <= now) {
      throw sessionExpired('Sessions end 12 hours after signing in.');
    }
    if (row.idleExpiresAt <= now) {
      throw sessionExpired('You were away for a while, so the session was locked.');
    }

    const user = this.#principal(row.userId);
    if (user === undefined) {
      throw sessionExpired('The account this session belongs to no longer exists.');
    }
    if (user.status !== 'ACTIVE') {
      throw accountDisabled();
    }

    let idleExpiresAt = row.idleExpiresAt;
    if (now - row.lastSeenAt >= SESSION_REFRESH_INTERVAL_MS) {
      idleExpiresAt = Math.min(now + this.autoLockMinutes() * 60_000, row.absoluteExpiresAt);
      this.#repo.touchSession(row.id, now, idleExpiresAt);
    }
    return { id: row.id, user, idleExpiresAt, absoluteExpiresAt: row.absoluteExpiresAt };
  }

  logout(session: ActiveSession, requestId?: string): void {
    this.#repo.revokeSession(session.id, this.#nowMs);
    this.#audit.append({
      actorKind: 'USER',
      actorUserId: session.user.id,
      action: 'auth.logout',
      entityKind: 'session',
      entityId: session.id,
      summary: `${session.user.email} signed out`,
      requestId: requestId ?? null,
    });
  }

  /**
   * Ruling R37: the lock screen is cosmetic, so unlocking must not mint a new
   * token — the UI is holding one in memory and has no way to learn a new one
   * without signing in again. It re-verifies the password and pushes the *same*
   * session's idle window forward.
   */
  async unlock(
    session: ActiveSession,
    password: string,
    requestId?: string,
  ): Promise<SessionExpiry> {
    const row = this.#repo.findUserById(session.user.id);
    if (row === undefined) {
      throw sessionExpired('The account this session belongs to no longer exists.');
    }
    if (!(await verifyPassword(row.passwordHash, password))) {
      this.#audit.append({
        actorKind: 'USER',
        actorUserId: row.id,
        action: 'auth.unlock.failed',
        entityKind: 'session',
        entityId: session.id,
        summary: `${row.email} entered the wrong password on the lock screen`,
        requestId: requestId ?? null,
      });
      throw invalidCredentials();
    }
    const now = this.#nowMs;
    const idleExpiresAt = Math.min(
      now + this.autoLockMinutes() * 60_000,
      session.absoluteExpiresAt,
    );
    this.#repo.touchSession(session.id, now, idleExpiresAt);
    this.#audit.append({
      actorKind: 'USER',
      actorUserId: row.id,
      action: 'auth.unlock',
      entityKind: 'session',
      entityId: session.id,
      summary: `${row.email} unlocked the app`,
      requestId: requestId ?? null,
    });
    return this.expiryOf({ ...session, idleExpiresAt });
  }

  /**
   * Changing a password ends every *other* session (§4.12): if the reason for
   * the change is that someone else knew the old one, leaving their session open
   * would defeat the point. The session doing the changing survives, so the user
   * is not thrown back to the login screen by their own action.
   */
  async changePassword(
    session: ActiveSession,
    currentPassword: string,
    newPassword: string,
    requestId?: string,
  ): Promise<void> {
    const row = this.#repo.findUserById(session.user.id);
    if (row === undefined || !(await verifyPassword(row.passwordHash, currentPassword))) {
      throw invalidCredentials();
    }
    this.#repo.setPassword(session.user.id, await hashPassword(newPassword));
    const revoked = this.#repo.revokeAllSessionsFor(session.user.id, this.#nowMs, session.id);
    this.#audit.append({
      actorKind: 'USER',
      actorUserId: session.user.id,
      action: 'auth.password.changed',
      entityKind: 'user',
      entityId: session.user.id,
      // Neither password appears here, nor anywhere else (R34, §15).
      summary: `${row.email} changed their password`,
      diff: { otherSessionsRevoked: revoked, mustChangePassword: false },
      requestId: requestId ?? null,
    });
  }

  /** The DTO shape of a session's clocks. */
  expiryOf(session: ActiveSession): SessionExpiry {
    return {
      idleExpiresAt: new Date(session.idleExpiresAt).toISOString(),
      absoluteExpiresAt: new Date(session.absoluteExpiresAt).toISOString(),
      autoLockMinutes: this.autoLockMinutes(),
    };
  }

  /** The `/me` body for a session. */
  describe(session: ActiveSession): {
    user: AuthUser;
    roles: RoleKey[];
    permissions: PermissionEntry[];
    session: SessionExpiry;
  } {
    const { user } = session;
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        departmentId: user.departmentId,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
      },
      roles: [...user.roles],
      permissions: [...permissionsFor(user.roles)],
      session: this.expiryOf(session),
    };
  }
}
