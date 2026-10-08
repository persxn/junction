import {
  CHECK_STATUSES,
  MACHINE_LABEL_MAX,
  RESOURCE_KINDS,
  RESOURCE_LABEL_MAX,
  RESOURCE_OWNER_KINDS,
  RESOURCE_URI_MAX,
  type CheckStatus,
  type ResourceKind,
  type ResourceOwnerKind,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { users } from './identity.js';

/**
 * §6.2 `resources` (D-12, §13, ADR-0013, rulings R102–R103, roadmap WP-20b):
 * references only — nothing is copied in. `owner_id` names a competition, a
 * stage, a task, or (OUTCOME) the competition whose outcome it is; it is
 * polymorphic, so there is no foreign key and the repository resolves every
 * owner to its competition and refuses an unknown one. Deleting an owner
 * deletes its resources in the same transaction (R103).
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const resources = sqliteTable(
  'resources',
  {
    id: text('id').primaryKey(),
    ownerKind: text('owner_kind').$type<ResourceOwnerKind>().notNull(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').$type<ResourceKind>().notNull(),
    label: text('label').notNull(),
    uri: text('uri').notNull(),
    machineLabel: text('machine_label'),
    lastCheckedAt: integer('last_checked_at'),
    checkStatus: text('check_status').$type<CheckStatus>().notNull().default('UNCHECKED'),
    addedBy: text('added_by')
      .notNull()
      .references(() => users.id),
    addedAt: integer('added_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('resources_owner_idx').on(table.ownerKind, table.ownerId),
    check('resources_owner_kind_check', sql.raw(inList('owner_kind', RESOURCE_OWNER_KINDS))),
    check('resources_kind_check', sql.raw(inList('kind', RESOURCE_KINDS))),
    check('resources_check_status_check', sql.raw(inList('check_status', CHECK_STATUSES))),
    check(
      'resources_uri_length_check',
      sql.raw(`length("uri") between 1 and ${String(RESOURCE_URI_MAX)}`),
    ),
    check(
      'resources_label_length_check',
      sql.raw(`length("label") between 1 and ${String(RESOURCE_LABEL_MAX)}`),
    ),
    check(
      'resources_machine_label_check',
      sql.raw(
        `"machine_label" is null or length("machine_label") between 1 and ${String(MACHINE_LABEL_MAX)}`,
      ),
    ),
    // A machine label belongs to a path on a PC, and only there.
    check(
      'resources_machine_label_kind_check',
      sql.raw(`"machine_label" is null or "kind" = 'LOCAL_PATH'`),
    ),
    check('resources_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type ResourceRow = typeof resources.$inferSelect;
