import { CLIENT_KINDS, ROLE_KEYS, USER_STATUSES } from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { departments } from './organization.js';
import { students } from './students.js';

/** `'A', 'B'` — CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * §6.2 "Identity & access".
 *
 * Nothing here stores a secret in the clear: `password_hash` is an Argon2id PHC
 * string and `sessions.token_hash` is a SHA-256 of a token that only ever
 * existed in one response body and in the client's memory (§4.12, ruling R33).
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** NULL for the very first admin, created before any department exists. */
    departmentId: text('department_id').references(() => departments.id),
    /** The login identifier, stored lower-cased so the unique index is the check. */
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** Argon2id PHC string; never logged, never exported, never in a DTO. */
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Consecutive failures; the R34 ladder is derived from it. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    /** While in the future, even a correct password is refused (R34). */
    lockedUntil: integer('locked_until'),
    lastLoginAt: integer('last_login_at'),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by'),
    updatedAt: integer('updated_at').notNull(),
    /** Optimistic concurrency on an editable aggregate (§6.1, §4.4). */
    version: integer('version').notNull().default(1),
    /** R132: the built-in, password-less guest of a student install. */
    isGuest: integer('is_guest', { mode: 'boolean' }).notNull().default(false),
    /** R135: "This is me" — the profile's own row among the students. */
    // Annotated: users ↔ students reference each other, and inference cannot
    // resolve the cycle on its own.
    studentId: text('student_id').references((): AnySQLiteColumn => students.id),
  },
  (table) => [
    uniqueIndex('users_email_uq').on(table.email),
    uniqueIndex('users_student_id_uq')
      .on(table.studentId)
      .where(sql`"student_id" is not null`),
    index('users_department_id_idx').on(table.departmentId),
    check('users_status_check', sql.raw(`"status" in (${quoted(USER_STATUSES)})`)),
    check('users_failed_login_count_check', sql.raw(`"failed_login_count" >= 0`)),
    // Lower-casing happens in code; this is what stops a second path writing
    // "A@B.edu" and creating a second account for the same person.
    check('users_email_lowercase_check', sql.raw(`"email" = lower("email")`)),
  ],
);
export type UserRow = typeof users.$inferSelect;

/** Seeded by migration 0002; §10 keeps the permissions in code, not here. */
export const roles = sqliteTable(
  'roles',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
  },
  (table) => [
    uniqueIndex('roles_key_uq').on(table.key),
    check('roles_key_check', sql.raw(`"key" in (${quoted(ROLE_KEYS)})`)),
  ],
);
export type RoleRow = typeof roles.$inferSelect;

/** A professor can also be an admin (§6.2), so this is a set, not a column. */
export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    grantedAt: integer('granted_at').notNull(),
    grantedBy: text('granted_by'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_role_id_idx').on(table.roleId),
  ],
);
export type UserRoleRow = typeof userRoles.$inferSelect;

/**
 * One row per signed-in client (ruling R33). Two clocks, because they answer
 * different questions: `idle_expires_at` moves forward with activity and is what
 * auto-lock enforces (§10.5), while `absolute_expires_at` never moves, so a
 * session cannot be kept alive for ever by a machine left running.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    /** Refreshed at most once every 60 s, so a busy client is not a write storm. */
    lastSeenAt: integer('last_seen_at').notNull(),
    idleExpiresAt: integer('idle_expires_at').notNull(),
    absoluteExpiresAt: integer('absolute_expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    clientKind: text('client_kind').notNull().default('DESKTOP'),
    clientLabel: text('client_label'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uq').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    // The cleanup job (WP-30) sweeps by this.
    index('sessions_absolute_expires_at_idx').on(table.absoluteExpiresAt),
    check('sessions_client_kind_check', sql.raw(`"client_kind" in (${quoted(CLIENT_KINDS)})`)),
  ],
);
export type SessionRow = typeof sessions.$inferSelect;
