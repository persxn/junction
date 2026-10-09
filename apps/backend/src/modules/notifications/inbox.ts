import {
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationList,
  type NotificationPreferenceUpdate,
  type NotificationPreferences,
  type NotificationQuery,
  type NotificationType,
} from '@compintel/contracts';

import { AppError } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import type { NotificationEngine } from './engine.js';
import type { NotificationsRepository } from './repo.js';
import { TYPE_DEFAULTS, effectivePreference } from './types.js';

/**
 * A person's inbox (WP-23, R111): their own notifications only, newest first,
 * snoozed and dismissed ones hidden; read, unread, snooze, dismiss (and undo)
 * are personal and not audited. Each change publishes `notification.updated`
 * to the person's other windows so every badge agrees.
 */

export const notificationNotFound = (): AppError =>
  new AppError({
    code: 'NOTIFICATION_NOT_FOUND',
    status: 404,
    title: 'No such notification',
    detail: 'That notification does not exist or is not yours.',
    retryable: false,
  });

export const snoozeInvalid = (): AppError =>
  new AppError({
    code: 'NOTIFICATION_SNOOZE_INVALID',
    status: 400,
    title: 'Choose a later time',
    detail: 'A snooze must end in the future and within 60 days.',
    retryable: false,
  });

const MAX_SNOOZE_MS = 60 * 24 * 60 * 60_000;

interface Row {
  id: string;
  type: NotificationType;
  severity: Notification['severity'];
  title: string;
  body: string;
  subjectKind: string | null;
  subjectId: string | null;
  route: string | null;
  dueAt: number | null;
  duePrecision: Notification['precision'];
  createdAt: number;
  readAt: number | null;
  snoozedUntil: number | null;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

const encodeCursor = (row: Row): string =>
  Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url');
const decodeCursor = (cursor: string): [number, string] | undefined => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string'
      ? [value[0], value[1]]
      : undefined;
  } catch {
    return undefined;
  }
};

export class InboxService {
  readonly #repo: NotificationsRepository;
  readonly #engine: NotificationEngine;
  readonly #clock: Clock;

  constructor(deps: { repo: NotificationsRepository; engine: NotificationEngine; clock?: Clock }) {
    this.#repo = deps.repo;
    this.#engine = deps.engine;
    this.#clock = deps.clock ?? systemClock;
  }

  get #now(): number {
    return nowMs(this.#clock);
  }

  list(userId: string, query: NotificationQuery): NotificationList {
    const now = this.#now;
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = this.#repo.db.raw
      .prepare(
        `SELECT id, type, severity, title, body, subject_kind AS subjectKind, subject_id AS subjectId, route,
           due_at AS dueAt, due_precision AS duePrecision, created_at AS createdAt, read_at AS readAt,
           snoozed_until AS snoozedUntil
         FROM notifications
         WHERE user_id = @userId AND dismissed_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= @now)
           ${query.state === 'unread' ? 'AND read_at IS NULL' : ''}
           ${after === undefined ? '' : 'AND (created_at < @at OR (created_at = @at AND id < @id))'}
         ORDER BY created_at DESC, id DESC LIMIT @limit`,
      )
      .all({
        userId,
        now,
        limit: query.limit + 1,
        ...(after === undefined ? {} : { at: after[0], id: after[1] }),
      }) as Row[];
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.#dto(userId, row)),
      unreadCount: this.#repo.unreadCount(userId, now),
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
    };
  }

  unreadCount(userId: string): number {
    return this.#repo.unreadCount(userId, this.#now);
  }

  markRead(userId: string, id: string): void {
    this.#update(userId, id, 'read_at = COALESCE(read_at, @now)');
  }

  markUnread(userId: string, id: string): void {
    this.#update(userId, id, 'read_at = NULL');
  }

  dismiss(userId: string, id: string): void {
    this.#update(userId, id, 'dismissed_at = @now');
  }

  /** Undo for dismiss. */
  restore(userId: string, id: string): void {
    this.#update(userId, id, 'dismissed_at = NULL');
  }

  snooze(userId: string, id: string, untilIso: string): void {
    const until = Date.parse(untilIso);
    const now = this.#now;
    if (!(until > now && until <= now + MAX_SNOOZE_MS)) throw snoozeInvalid();
    this.#update(userId, id, 'snoozed_until = @until', { until });
  }

  readAll(userId: string): void {
    this.#repo.db.raw
      .prepare(
        `UPDATE notifications SET read_at = @now WHERE user_id = @userId AND read_at IS NULL
           AND dismissed_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= @now)`,
      )
      .run({ userId, now: this.#now });
    this.#engine.published(userId, null);
  }

  preferences(userId: string): NotificationPreferences {
    const stored = new Map(this.#repo.preferences(userId).map((row) => [row.type, row]));
    return {
      preferences: NOTIFICATION_TYPES.map((type) => effectivePreference(type, stored.get(type))),
    };
  }

  savePreferences(userId: string, update: NotificationPreferenceUpdate): NotificationPreferences {
    const upsert = this.#repo.db.raw.prepare(
      `INSERT INTO notification_preferences (user_id, type, is_enabled, thresholds_json, toast_enabled)
       VALUES (@userId, @type, @isEnabled, @thresholdsJson, @toastEnabled)
       ON CONFLICT(user_id, type) DO UPDATE SET is_enabled = excluded.is_enabled,
         thresholds_json = excluded.thresholds_json, toast_enabled = excluded.toast_enabled`,
    );
    this.#repo.db.raw.transaction(() => {
      for (const preference of update.preferences) {
        const takesThresholds = TYPE_DEFAULTS[preference.type].thresholds !== null;
        upsert.run({
          userId,
          type: preference.type,
          isEnabled: preference.isEnabled ? 1 : 0,
          thresholdsJson:
            takesThresholds && preference.thresholds != null
              ? JSON.stringify(preference.thresholds)
              : null,
          toastEnabled: preference.toastEnabled ? 1 : 0,
        });
      }
    })();
    this.#engine.forget(userId);
    return this.preferences(userId);
  }

  #update(userId: string, id: string, set: string, extra: Record<string, unknown> = {}): void {
    const result = this.#repo.db.raw
      .prepare(`UPDATE notifications SET ${set} WHERE id = @id AND user_id = @userId`)
      .run({ id, userId, now: this.#now, ...extra });
    if (result.changes === 0) throw notificationNotFound();
    this.#engine.published(userId, id);
  }

  #dto(userId: string, row: Row): Notification {
    return {
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      body: row.body,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      route: row.route,
      dueAt: iso(row.dueAt),
      precision: row.duePrecision,
      createdAt: new Date(row.createdAt).toISOString(),
      readAt: iso(row.readAt),
      snoozedUntil: iso(row.snoozedUntil),
      toast: row.severity === 'CRITICAL' && this.#engine.preference(userId, row.type).toastEnabled,
    };
  }
}
