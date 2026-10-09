import {
  DATE_PRECISIONS,
  NOTIFICATION_TYPES,
  SEVERITIES,
  type DatePrecision,
  type NotificationType,
  type Severity,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { users } from './identity.js';

/**
 * §6.2 `notifications` and `notification_preferences` (Q4, rulings R108–R111,
 * roadmap WP-23). One row per (recipient, dedupe key): insert-or-ignore makes
 * each threshold fire once, and because the due time is part of the key a
 * moved deadline re-arms them. `due_at`/`due_precision` are the subject's due
 * time as shown ("27 Sep (time not stated)") and snooze's "due day" anchor.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').$type<NotificationType>().notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),
    route: text('route'),
    dedupeKey: text('dedupe_key').notNull(),
    dueAt: integer('due_at'),
    duePrecision: text('due_precision').$type<DatePrecision>(),
    createdAt: integer('created_at').notNull(),
    readAt: integer('read_at'),
    snoozedUntil: integer('snoozed_until'),
    dismissedAt: integer('dismissed_at'),
  },
  (table) => [
    uniqueIndex('notifications_user_dedupe_uq').on(table.userId, table.dedupeKey),
    index('notifications_inbox_idx').on(table.userId, table.readAt, table.snoozedUntil),
    index('notifications_snoozed_idx').on(table.snoozedUntil),
    check('notifications_type_check', sql.raw(inList('type', NOTIFICATION_TYPES))),
    check('notifications_severity_check', sql.raw(inList('severity', SEVERITIES))),
    check(
      'notifications_precision_check',
      sql.raw(`"due_precision" is null or ${inList('due_precision', DATE_PRECISIONS)}`),
    ),
    // An in-app route only (R90's activation accepts nothing else).
    check('notifications_route_check', sql.raw(`"route" is null or "route" like '/%'`)),
  ],
);
export type NotificationRow = typeof notifications.$inferSelect;

export const notificationPreferences = sqliteTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').$type<NotificationType>().notNull(),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull(),
    thresholdsJson: text('thresholds_json'),
    toastEnabled: integer('toast_enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.type] }),
    check('notification_preferences_type_check', sql.raw(inList('type', NOTIFICATION_TYPES))),
  ],
);
export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
