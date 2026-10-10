import type { ClientKind, RoleKey, Uuid7 } from '@compintel/contracts';
import { eq } from 'drizzle-orm';

import {
  roles,
  sessions,
  userRoles,
  users,
  type SessionRow,
  type UserRow,
} from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';

/**
 * Every query the auth module makes, in one place. Nothing here decides
 * anything: the service owns the rules, this owns the SQL.
 */

export interface NewUser {
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly departmentId?: string | null;
  readonly mustChangePassword?: boolean;
  readonly roles: readonly RoleKey[];
  readonly createdBy?: string | null;
}

export interface NewSession {
  readonly userId: string;
  readonly tokenHash: string;
  readonly idleExpiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly clientKind: ClientKind;
  readonly clientLabel?: string | undefined;
}

export interface AuthRepositoryOptions {
  readonly clock?: Clock;
  readonly newId?: () => Uuid7;
}

/** The login identifier is compared case-insensitively (§6.2 `users.email`). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class AuthRepository {
  readonly #db: DatabaseHandle;
  readonly #clock: Clock;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, options: AuthRepositoryOptions = {}) {
    this.#db = db;
    this.#clock = options.clock ?? systemClock;
    this.#newId = options.newId ?? uuid7;
  }

  /** Milliseconds since the epoch, the shape every timestamp column wants. */
  get #nowMs(): number {
    return nowMs(this.#clock);
  }

  get #drizzle(): DatabaseHandle['drizzle'] {
    return this.#db.drizzle;
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.#drizzle
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get();
  }

  findUserById(id: string): UserRow | undefined {
    return this.#drizzle.select().from(users).where(eq(users.id, id)).get();
  }

  rolesOf(userId: string): readonly RoleKey[] {
    return this.#drizzle
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .all()
      .map((row) => row.key as RoleKey);
  }

  /**
   * Creates an account and grants its roles in one transaction. No route calls
   * this yet — WP-07b's wizard and user administration do — but the tests and
   * the first-admin path need it, and an account that exists without its roles
   * would be a user who can sign in and do nothing.
   */
  createUser(user: NewUser): UserRow {
    const write = this.#db.raw.transaction((): UserRow => {
      const now = this.#nowMs;
      const row = {
        id: this.#newId(),
        departmentId: user.departmentId ?? null,
        email: normalizeEmail(user.email),
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        status: 'ACTIVE' as const,
        mustChangePassword: user.mustChangePassword ?? false,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        createdBy: user.createdBy ?? null,
        updatedAt: now,
        version: 1,
        isGuest: false,
        studentId: null,
      };
      this.#drizzle.insert(users).values(row).run();
      for (const key of user.roles) {
        const role = this.#drizzle.select().from(roles).where(eq(roles.key, key)).get();
        if (role === undefined) {
          throw new Error(`role "${key}" is not seeded; migration 0003 did not run`);
        }
        this.#drizzle
          .insert(userRoles)
          .values({
            userId: row.id,
            roleId: role.id,
            grantedAt: now,
            grantedBy: user.createdBy ?? null,
          })
          .run();
      }
      return row;
    });
    return write.immediate();
  }

  /** Bumps the failure counter and, at a threshold, sets `locked_until` (R34). */
  recordFailedLogin(userId: string, lockedUntil: number | undefined): number {
    const current = this.findUserById(userId);
    const next = (current?.failedLoginCount ?? 0) + 1;
    this.#drizzle
      .update(users)
      .set({
        failedLoginCount: next,
        ...(lockedUntil === undefined ? {} : { lockedUntil }),
        updatedAt: this.#nowMs,
      })
      .where(eq(users.id, userId))
      .run();
    return next;
  }

  /** A success clears both the counter and any lock (R34). */
  recordSuccessfulLogin(userId: string): void {
    const now = this.#nowMs;
    this.#drizzle
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, userId))
      .run();
  }

  setLockedUntil(userId: string, lockedUntil: number | null): void {
    this.#drizzle
      .update(users)
      .set({ lockedUntil, updatedAt: this.#nowMs })
      .where(eq(users.id, userId))
      .run();
  }

  setPassword(userId: string, passwordHash: string): void {
    const now = this.#nowMs;
    this.#drizzle
      .update(users)
      .set({ passwordHash, mustChangePassword: false, updatedAt: now })
      .where(eq(users.id, userId))
      .run();
  }

  createSession(session: NewSession): SessionRow {
    const now = this.#nowMs;
    const row = {
      id: this.#newId(),
      userId: session.userId,
      tokenHash: session.tokenHash,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: null,
      clientKind: session.clientKind,
      clientLabel: session.clientLabel ?? null,
    };
    this.#drizzle.insert(sessions).values(row).run();
    return row;
  }

  findSessionByTokenHash(tokenHash: string): SessionRow | undefined {
    return this.#drizzle.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
  }

  /** Moves the idle window forward; the absolute one is never touched (R33). */
  touchSession(sessionId: string, at: number, idleExpiresAt: number): void {
    this.#drizzle
      .update(sessions)
      .set({ lastSeenAt: at, idleExpiresAt })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  revokeSession(sessionId: string, at: number): void {
    this.#drizzle.update(sessions).set({ revokedAt: at }).where(eq(sessions.id, sessionId)).run();
  }

  /** Ends every session a user holds — what a password change does (§4.12). */
  revokeAllSessionsFor(userId: string, at: number, exceptSessionId?: string): number {
    const rows = this.#drizzle
      .select({ id: sessions.id, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .all();
    let revoked = 0;
    for (const row of rows) {
      if (row.revokedAt !== null || row.id === exceptSessionId) {
        continue;
      }
      this.#drizzle.update(sessions).set({ revokedAt: at }).where(eq(sessions.id, row.id)).run();
      revoked += 1;
    }
    return revoked;
  }
}
