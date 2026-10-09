import { z } from 'zod';

import { DatePrecision } from './enums.js';
import { Uuid7 } from './ids.js';

/**
 * Notifications (§12, §6.2, Q4, rulings R108–R111, WP-23): in-app only (D-19),
 * with a tray count and Windows toasts for CRITICAL ones (R90). Each type has
 * a registry default; a person can turn a type off, override its thresholds
 * and turn its toasts off.
 */

export const NOTIFICATION_TYPES = [
  'REG_DEADLINE',
  'SUBMISSION_DEADLINE',
  'STAGE_DUE',
  'TASK_DUE',
  'OVERDUE',
  'NEW_MATCH',
  'EVENT_CHANGED',
  'EVENT_CANCELLED',
  'SCRAPER_FAILING',
  'BACKUP_FAILED',
  'SOURCE_BLOCKED',
  'CREDENTIAL_EXPIRED',
  'SYSTEM',
] as const;
export const NotificationType = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationType>;

export const NOTIFICATION_TYPE_LABELS: Readonly<Record<NotificationType, string>> = {
  REG_DEADLINE: 'Registration deadlines',
  SUBMISSION_DEADLINE: 'Event deadlines',
  STAGE_DUE: 'Stage due dates',
  TASK_DUE: 'Task due dates',
  OVERDUE: 'Overdue work',
  NEW_MATCH: 'New matching events',
  EVENT_CHANGED: 'Deadline changes',
  EVENT_CANCELLED: 'Cancelled events',
  SCRAPER_FAILING: 'Sources failing',
  BACKUP_FAILED: 'Backup failures',
  SOURCE_BLOCKED: 'Sources blocked',
  CREDENTIAL_EXPIRED: 'Source sign-ins expired',
  SYSTEM: 'System messages',
};

export const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  INFO: 'Info',
  WARNING: 'Warning',
  CRITICAL: 'Urgent',
};

/** Which day thresholds fire (R108): days before, the due day, and overdue (our work only). */
export const Thresholds = z
  .object({
    days: z.array(z.int().min(1).max(60)).max(6),
    dueDay: z.boolean(),
    overdue: z.boolean(),
  })
  .strict();
export type Thresholds = z.infer<typeof Thresholds>;

export const Notification = z
  .object({
    id: Uuid7,
    type: NotificationType,
    severity: Severity,
    title: z.string().min(1),
    body: z.string(),
    subjectKind: z.string().nullable(),
    subjectId: z.string().nullable(),
    /** An in-app route ("/competitions/<id>"); never an external link. */
    route: z.string().nullable(),
    /** For "due 27 Sep (time not stated)" — kept with its precision. */
    dueAt: z.iso.datetime().nullable(),
    precision: DatePrecision.nullable(),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
    snoozedUntil: z.iso.datetime().nullable(),
  })
  .strict();
export type Notification = z.infer<typeof Notification>;

export const NOTIFICATION_STATES = ['unread', 'all'] as const;

export const NotificationQuery = z
  .object({
    state: z.enum(NOTIFICATION_STATES).default('all'),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type NotificationQuery = z.infer<typeof NotificationQuery>;

export const NotificationList = z
  .object({
    items: z.array(Notification),
    unreadCount: z.int().min(0),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type NotificationList = z.infer<typeof NotificationList>;

export const UnreadCount = z.object({ unreadCount: z.int().min(0) }).strict();
export type UnreadCount = z.infer<typeof UnreadCount>;

export const SnoozeRequest = z.object({ until: z.iso.datetime() }).strict();
export type SnoozeRequest = z.infer<typeof SnoozeRequest>;

export const NotificationPreference = z
  .object({
    type: NotificationType,
    isEnabled: z.boolean(),
    /** Null for types without thresholds (changes, admin notices). */
    thresholds: Thresholds.nullable(),
    toastEnabled: z.boolean(),
    /** True while nothing is stored: the registry default applies. */
    isDefault: z.boolean(),
  })
  .strict();
export type NotificationPreference = z.infer<typeof NotificationPreference>;

export const NotificationPreferences = z
  .object({ preferences: z.array(NotificationPreference) })
  .strict();
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const NotificationPreferenceUpdate = z
  .object({
    preferences: z
      .array(
        z
          .object({
            type: NotificationType,
            isEnabled: z.boolean(),
            thresholds: Thresholds.nullable().optional(),
            toastEnabled: z.boolean(),
          })
          .strict(),
      )
      .max(NOTIFICATION_TYPES.length),
  })
  .strict();
export type NotificationPreferenceUpdate = z.infer<typeof NotificationPreferenceUpdate>;

/** Stream payloads carry ids only (R36); the UI fetches what it shows. */
export const NotificationStreamPayload = z
  .object({ id: Uuid7.nullable(), unreadCount: z.int().min(0) })
  .strict();
export type NotificationStreamPayload = z.infer<typeof NotificationStreamPayload>;
