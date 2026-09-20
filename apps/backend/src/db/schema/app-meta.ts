import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * A tiny key/value table so the backend can tell a brand-new database from one
 * that has been upgraded, without adding a domain table before WP-04c. Values
 * are TEXT because the keys are heterogeneous; timestamps follow the §6.1
 * convention (Unix milliseconds, UTC).
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type AppMetaRow = typeof appMeta.$inferSelect;

/** When this database file was first created, ISO 8601. */
export const APP_META_SCHEMA_CREATED_AT = 'schema_created_at';

/** The `appVersion` of the last backend that opened this database. */
export const APP_META_LAST_APP_VERSION = 'last_app_version';
