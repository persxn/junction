import type { RoleKey, Uuid7 } from '@compintel/contracts';
import { and, eq } from 'drizzle-orm';

import {
  campuses,
  departments,
  organizations,
  roles,
  userRoles,
  users,
  type OrganizationRow,
} from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';

/**
 * Every query the setup module makes. As with the auth repository, nothing here
 * decides anything: the service owns the rules, this owns the SQL — and one
 * transaction (ruling R40).
 */

export interface SetupRepositoryOptions {
  readonly clock?: Clock;
  readonly newId?: () => Uuid7;
}

/** What `completeSetup` writes, already hashed and validated by the service. */
export interface SetupWrite {
  readonly organization: { readonly name: string; readonly shortName?: string | undefined };
  readonly department: { readonly name: string; readonly code?: string | undefined };
  readonly campus: { readonly name: string; readonly lat: number; readonly lon: number };
  readonly admin: {
    readonly email: string;
    readonly displayName: string;
    readonly passwordHash: string;
  };
  /** Applied inside the same transaction, so a settings failure rolls the rest back. */
  readonly settings: readonly (readonly [key: string, valueJson: string])[];
}

export interface SetupWriteResult {
  readonly organizationId: string;
  readonly departmentId: string;
  readonly campusId: string;
  readonly adminUserId: string;
}

export class SetupRepository {
  readonly #db: DatabaseHandle;
  readonly #clock: Clock;
  readonly #newId: () => Uuid7;

  constructor(db: DatabaseHandle, options: SetupRepositoryOptions = {}) {
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

  /**
   * Whether any usable administrator exists — the whole R39 gate in one query.
   *
   * DISABLED admins do not count: an installation whose only admin was disabled
   * is one nobody can administer, and the gate must not hide that behind a login
   * screen no one can get past.
   */
  hasActiveAdministrator(): boolean {
    const row = this.#drizzle
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.key, 'ADMINISTRATOR'), eq(users.status, 'ACTIVE')))
      .limit(1)
      .get();
    return row !== undefined;
  }

  organization(): OrganizationRow | undefined {
    return this.#drizzle.select().from(organizations).limit(1).get();
  }

  /**
   * Ruling R40: organization, department, campus, the first admin, their roles
   * and every setting land together or not at all. `IMMEDIATE` so the write lock
   * is taken up front rather than half way through.
   */
  completeSetup(write: SetupWrite): SetupWriteResult {
    const apply = this.#db.raw.transaction((): SetupWriteResult => {
      const now = this.#nowMs;
      const organizationId = this.#newId();
      const departmentId = this.#newId();
      const campusId = this.#newId();
      const adminUserId = this.#newId();

      this.#drizzle
        .insert(organizations)
        .values({
          id: organizationId,
          name: write.organization.name,
          shortName: write.organization.shortName ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      this.#drizzle
        .insert(departments)
        .values({
          id: departmentId,
          organizationId,
          name: write.department.name,
          code: write.department.code ?? null,
          isManaging: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      this.#drizzle
        .insert(campuses)
        .values({
          id: campusId,
          organizationId,
          name: write.campus.name,
          lat: write.campus.lat,
          lon: write.campus.lon,
          isPrimary: true,
          updatedBy: adminUserId,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      this.#drizzle
        .insert(users)
        .values({
          id: adminUserId,
          departmentId,
          email: write.admin.email,
          displayName: write.admin.displayName,
          passwordHash: write.admin.passwordHash,
          status: 'ACTIVE',
          // They chose it themselves thirty seconds ago (R38 has nothing to fix).
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: null,
          createdAt: now,
          createdBy: null,
          updatedAt: now,
          version: 1,
        })
        .run();

      // Both roles: the first account is the only account, and an installation
      // whose admin cannot mentor a team would need a second user to do anything.
      for (const key of ['ADMINISTRATOR', 'PROFESSOR'] satisfies RoleKey[]) {
        const role = this.#drizzle.select().from(roles).where(eq(roles.key, key)).get();
        if (role === undefined) {
          throw new Error(`role "${key}" is not seeded; migration 0003 did not run`);
        }
        this.#drizzle
          .insert(userRoles)
          .values({ userId: adminUserId, roleId: role.id, grantedAt: now, grantedBy: null })
          .run();
      }

      for (const [key, valueJson] of write.settings) {
        this.#db.raw
          .prepare(
            'insert into settings (key, value_json, updated_by, updated_at) values (?, ?, ?, ?) ' +
              'on conflict(key) do update set value_json = excluded.value_json, ' +
              'updated_by = excluded.updated_by, updated_at = excluded.updated_at',
          )
          .run(key, valueJson, adminUserId, now);
      }

      return { organizationId, departmentId, campusId, adminUserId };
    });
    return apply.immediate();
  }

  /** How many migrations have been applied, for the recovery file's header. */
  schemaVersion(): number {
    const row = this.#db.raw
      .prepare('select count(*) as applied from __drizzle_migrations')
      .get() as { applied?: number } | undefined;
    return row?.applied ?? 0;
  }
}
