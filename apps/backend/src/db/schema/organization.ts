import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * §6.2 "Organization & configuration". These tables exist now, empty, so that
 * WP-07b's first-run wizard has somewhere to put what it asks for — and so that
 * `users.department_id` has something to point at from the first migration that
 * creates a user.
 *
 * §6.1 conventions throughout: UUIDv7 TEXT keys, INTEGER Unix-millisecond
 * timestamps, TEXT enums with CHECK constraints.
 */

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export type OrganizationRow = typeof organizations.$inferSelect;

/**
 * Every department a student can come from, of which exactly one is ours:
 * `is_managing` marks the department this installation belongs to, and the rest
 * are reference entries for students' home departments (§6.2).
 */
export const departments = sqliteTable(
  'departments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    code: text('code'),
    isManaging: integer('is_managing', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('departments_organization_id_idx').on(table.organizationId),
    uniqueIndex('departments_org_code_uq').on(table.organizationId, table.code),
  ],
);
export type DepartmentRow = typeof departments.$inferSelect;

/** Where the institution physically is; distances are measured from the primary one. */
export const campuses = sqliteTable(
  'campuses',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    /** Decimal degrees. NULL until the wizard geocodes the address (§4.17). */
    lat: real('lat'),
    lon: real('lon'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    updatedBy: text('updated_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('campuses_organization_id_idx').on(table.organizationId),
    check('campuses_lat_range_check', sql.raw(`"lat" is null or ("lat" >= -90 and "lat" <= 90)`)),
    check('campuses_lon_range_check', sql.raw(`"lon" is null or ("lon" >= -180 and "lon" <= 180)`)),
  ],
);
export type CampusRow = typeof campuses.$inferSelect;

/**
 * The typed setting registry (§6.2). The table is deliberately untyped — one
 * key, one JSON value — and the types live in code (`platform/settings.ts`), so
 * a new setting is a code change and never a migration.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  /** JSON text; the registry parses it against that key's schema on read. */
  valueJson: text('value_json').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: integer('updated_at').notNull(),
});
export type SettingRow = typeof settings.$inferSelect;
