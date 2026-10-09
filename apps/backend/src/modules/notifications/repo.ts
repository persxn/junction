import type { NotificationType } from '@compintel/contracts';

import type { EventChange } from '../../domain/notifications/recipients.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { StoredPreference } from './types.js';

/**
 * The notification engine's SQL (WP-23, R108–R111): the facts R109's recipients
 * are drawn from, insert-or-ignore on UQ(user_id, dedupe_key), the change
 * watermark and admin-notice episodes in `app_meta`, and resurfacing.
 */

export const CHANGES_WATERMARK_KEY = 'notifications.changesWatermark';
export const ADMIN_EPISODES_KEY = 'notifications.adminEpisodes';

const ACTIVE_COMPETITION = `('ASSIGNED', 'APPLIED', 'PARTICIPATING')`;
const MENTOR_VALID = `m.from_at <= @now AND (m.to_at IS NULL OR m.to_at > @now)`;
const WATCHED_FIELDS = `('registrationDeadlineAt', 'submissionDeadlineAt', 'cancellation')`;

export interface NewNotification {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly severity: string;
  readonly title: string;
  readonly body: string;
  readonly subjectKind: string | null;
  readonly subjectId: string | null;
  readonly route: string | null;
  readonly dedupeKey: string;
  readonly dueAt: number | null;
  readonly duePrecision: string | null;
  readonly createdAt: number;
}

export interface AdminState {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly blocked: boolean;
  readonly credentialFailed: boolean;
  readonly failing: boolean;
}

export class NotificationsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  get db(): DatabaseHandle {
    return this.#db;
  }

  mentorsOf(engagementId: string, now: number): string[] {
    return this.#column(
      `SELECT DISTINCT m.user_id FROM engagement_mentors m JOIN users u ON u.id = m.user_id
       WHERE m.engagement_id = @engagementId AND ${MENTOR_VALID} AND u.status = 'ACTIVE'`,
      { engagementId, now },
    );
  }

  /** Savers who have not hidden it. */
  saversOf(eventId: string): string[] {
    return this.#column(
      `SELECT DISTINCT w.user_id FROM watchlist_items w JOIN users u ON u.id = w.user_id
       WHERE w.event_id = @eventId AND u.status = 'ACTIVE' AND NOT EXISTS (
         SELECT 1 FROM event_user_state s WHERE s.event_id = w.event_id AND s.user_id = w.user_id AND s.is_hidden = 1)`,
      { eventId },
    );
  }

  competitionMentorsOfEvent(eventId: string, now: number): string[] {
    return this.#column(
      `SELECT DISTINCT m.user_id FROM engagements g
       JOIN engagement_mentors m ON m.engagement_id = g.id JOIN users u ON u.id = m.user_id
       WHERE g.event_id = @eventId AND g.status IN ${ACTIVE_COMPETITION} AND ${MENTOR_VALID}
         AND u.status = 'ACTIVE'`,
      { eventId, now },
    );
  }

  hasActiveCompetition(eventId: string): boolean {
    return (
      this.#db.raw
        .prepare(
          `SELECT 1 FROM engagements WHERE event_id = ? AND status IN ${ACTIVE_COMPETITION} LIMIT 1`,
        )
        .get(eventId) !== undefined
    );
  }

  activeAdmins(): string[] {
    return this.#column(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id WHERE r.key = 'ADMINISTRATOR' AND u.status = 'ACTIVE'`,
      {},
    );
  }

  eventTitle(eventId: string): string {
    const row = this.#db.raw.prepare('SELECT title FROM events WHERE id = ?').get(eventId) as
      { title: string } | undefined;
    return row?.title ?? 'An event';
  }

  preferences(userId: string): StoredPreference[] {
    return this.#db.raw
      .prepare(
        `SELECT type, is_enabled AS isEnabled, thresholds_json AS thresholdsJson, toast_enabled AS toastEnabled
         FROM notification_preferences WHERE user_id = ?`,
      )
      .all(userId)
      .map((row) => {
        const r = row as {
          type: NotificationType;
          isEnabled: number;
          thresholdsJson: string | null;
          toastEnabled: number;
        };
        return {
          type: r.type,
          isEnabled: r.isEnabled === 1,
          thresholdsJson: r.thresholdsJson,
          toastEnabled: r.toastEnabled === 1,
        };
      });
  }

  /** Which of these keys this user already has. */
  existingKeys(userId: string, keys: readonly string[]): Set<string> {
    if (keys.length === 0) return new Set();
    const rows = this.#db.raw
      .prepare(
        `SELECT dedupe_key AS key FROM notifications WHERE user_id = ? AND dedupe_key IN (${keys.map(() => '?').join(', ')})`,
      )
      .all(userId, ...keys) as { key: string }[];
    return new Set(rows.map((row) => row.key));
  }

  /** R108: insert-or-ignore; true when the row is new. */
  insert(row: NewNotification): boolean {
    const result = this.#db.raw
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, type, severity, title, body, subject_kind, subject_id,
           route, dedupe_key, due_at, due_precision, created_at)
         VALUES (@id, @userId, @type, @severity, @title, @body, @subjectKind, @subjectId,
           @route, @dedupeKey, @dueAt, @duePrecision, @createdAt)`,
      )
      .run(row);
    return result.changes === 1;
  }

  unreadCount(userId: string, now: number): number {
    const row = this.#db.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM notifications WHERE user_id = @userId AND read_at IS NULL
           AND dismissed_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= @now)`,
      )
      .get({ userId, now }) as { n: number };
    return row.n;
  }

  /** Snoozed rows that may be due back (the domain decides). */
  snoozed(
    now: number,
  ): { id: string; userId: string; snoozedUntil: number | null; dismissedAt: number | null }[] {
    return this.#db.raw
      .prepare(
        `SELECT id, user_id AS userId, snoozed_until AS snoozedUntil, dismissed_at AS dismissedAt
         FROM notifications WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?`,
      )
      .all(now) as {
      id: string;
      userId: string;
      snoozedUntil: number | null;
      dismissedAt: number | null;
    }[];
  }

  /** R111: back, unread. */
  resurface(id: string): void {
    this.#db.raw
      .prepare('UPDATE notifications SET snoozed_until = NULL, read_at = NULL WHERE id = ?')
      .run(id);
  }

  changesAfter(watermark: string): EventChange[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT id, event_id AS eventId, field, old_value_json AS oldJson, new_value_json AS newJson,
           changed_by AS changedBy FROM event_changes WHERE id > ? AND field IN ${WATCHED_FIELDS} ORDER BY id`,
      )
      .all(watermark) as {
      id: string;
      eventId: string;
      field: EventChange['field'];
      oldJson: string | null;
      newJson: string | null;
      changedBy: string | null;
    }[];
    const parse = (json: string | null): unknown =>
      json === null ? null : (JSON.parse(json) as unknown);
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      field: row.field,
      oldValue: parse(row.oldJson),
      newValue: parse(row.newJson),
      changedBy: row.changedBy,
    }));
  }

  latestChangeId(): string {
    const row = this.#db.raw.prepare('SELECT MAX(id) AS id FROM event_changes').get() as {
      id: string | null;
    };
    return row.id ?? '';
  }

  adminStates(): AdminState[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT s.id AS sourceId, s.name AS sourceName, s.compliance_status AS compliance,
           st.credential_state AS credential, COALESCE(st.consecutive_failures, 0) AS failures
         FROM sources s LEFT JOIN source_state st ON st.source_id = s.id`,
      )
      .all() as {
      sourceId: string;
      sourceName: string;
      compliance: string;
      credential: string | null;
      failures: number;
    }[];
    return rows.map((row) => ({
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      blocked: row.compliance === 'BLOCKED',
      credentialFailed: row.credential !== null,
      // §12: three consecutive failures.
      failing: row.failures >= 3,
    }));
  }

  meta(key: string): string | undefined {
    const row = this.#db.raw.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string, now: number): void {
    this.#db.raw
      .prepare(
        `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  #column(sql: string, params: Record<string, unknown>): string[] {
    return this.#db.raw.prepare(sql).pluck().all(params) as string[];
  }
}
