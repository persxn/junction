import type { RoleKey, Uuid7 } from '@compintel/contracts';
import { and, eq, inArray } from 'drizzle-orm';

import { roles, userRoles, users, type UserRow } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';

/**
 * The queries user administration needs, on top of `AuthRepository` (which owns
 * everything a login touches). Keeping the two apart means the login path never
 * grows a join it does not need, and this one can list and count freely.
 */

export interface UserWithRoles {
  readonly user: UserRow;
  readonly roles: readonly RoleKey[];
}

export interface UsersRepositoryOptions {
  readonly clock?: Clock;
  readonly newId?: () => Uuid7;
}

export class UsersRepository {
  readonly #db: DatabaseHandle;
  readonly #clock: Clock;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, options: UsersRepositoryOptions = {}) {
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

  /** Everyone, oldest first — UUIDv7 keys sort by creation (§6.1). */
  list(): readonly UserWithRoles[] {
    const rows = this.#drizzle.select().from(users).orderBy(users.id).all();
    if (rows.length === 0) {
      return [];
    }
    const grants = this.#drizzle
      .select({ userId: userRoles.userId, key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        inArray(
          userRoles.userId,
          rows.map((row) => row.id),
        ),
      )
      .all();

    const byUser = new Map<string, RoleKey[]>();
    for (const grant of grants) {
      const list = byUser.get(grant.userId) ?? [];
      list.push(grant.key as RoleKey);
      byUser.set(grant.userId, list);
    }
    return rows.map((user) => ({ user, roles: byUser.get(user.id) ?? [] }));
  }

  find(id: string): UserWithRoles | undefined {
    const user = this.#drizzle.select().from(users).where(eq(users.id, id)).get();
    if (user === undefined) {
      return undefined;
    }
    return { user, roles: this.rolesOf(id) };
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
   * How many ACTIVE accounts hold ADMINISTRATOR. The guard against locking an
   * installation out of itself reads this before it lets an admin go.
   */
  activeAdministratorCount(): number {
    return this.#drizzle
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.key, 'ADMINISTRATOR'), eq(users.status, 'ACTIVE')))
      .all().length;
  }

  setStatus(userId: string, status: 'ACTIVE' | 'DISABLED'): void {
    const now = this.#nowMs;
    this.#db.raw
      .prepare('update users set status = ?, updated_at = ?, version = version + 1 where id = ?')
      .run(status, now, userId);
  }

  /**
   * Renames and re-roles in one transaction, refusing a stale `version` (§6.1).
   * Returns false when the version did not match, so the caller answers 409.
   */
  update(
    userId: string,
    expectedVersion: number,
    changes: { readonly displayName?: string; readonly roles?: readonly RoleKey[] },
  ): boolean {
    const apply = this.#db.raw.transaction((): boolean => {
      const now = this.#nowMs;
      const result = this.#db.raw
        .prepare(
          'update users set display_name = coalesce(?, display_name), updated_at = ?, ' +
            'version = version + 1 where id = ? and version = ?',
        )
        .run(changes.displayName ?? null, now, userId, expectedVersion);
      if (result.changes === 0) {
        return false;
      }
      if (changes.roles !== undefined) {
        this.#drizzle.delete(userRoles).where(eq(userRoles.userId, userId)).run();
        for (const key of changes.roles) {
          const role = this.#drizzle.select().from(roles).where(eq(roles.key, key)).get();
          if (role === undefined) {
            throw new Error(`role "${key}" is not seeded`);
          }
          this.#drizzle
            .insert(userRoles)
            .values({ userId, roleId: role.id, grantedAt: now, grantedBy: null })
            .run();
        }
      }
      return true;
    });
    return apply.immediate();
  }

  /** A reset puts the account back to "must change it on the way in" (R38). */
  resetPassword(userId: string, passwordHash: string): void {
    this.#db.raw
      .prepare(
        'update users set password_hash = ?, must_change_password = 1, failed_login_count = 0, ' +
          'locked_until = null, updated_at = ?, version = version + 1 where id = ?',
      )
      .run(passwordHash, this.#nowMs, userId);
  }

  /** Only used to mint ids for the audit trail's entity ids. */
  nextId(): Uuid7 {
    return this.#newId();
  }
}
