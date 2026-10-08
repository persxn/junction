import type {
  CompetitionQuery,
  EngagementStatus,
  MentorRole,
  ParticipantKind,
  RemovalReason,
} from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';
import type {
  EventRecord,
  EngagementRecord,
  ParticipantRecord,
  CompetitionMentorRecord,
  HistoryRecord,
  ActiveParticipation,
  DeadlineRecord,
} from './records.js';

export type {
  EventRecord,
  EngagementRecord,
  ParticipantRecord,
  CompetitionMentorRecord,
  HistoryRecord,
  ActiveParticipation,
  DeadlineRecord,
} from './records.js';

/**
 * Every SQL statement about competitions (WP-19 ground rules: SQL only in
 * repositories). Participant and mentor rows are opened and closed, never
 * deleted (R97); a re-added student reopens his row (PK engagement + student).
 */

const placeholders = (values: readonly unknown[]): string => values.map(() => '?').join(', ');

const EVENT_COLUMNS = `e.id, e.title, e.event_type AS eventType,
  e.registration_deadline_at AS registrationDeadlineAt,
  e.registration_deadline_precision AS registrationDeadlinePrecision,
  e.starts_at AS startsAt, e.date_precision AS datePrecision, e.ends_at AS endsAt, e.timezone,
  e.cancellation, e.team_min AS teamMin, e.team_max AS teamMax, e.visibility,
  e.merged_into_event_id AS mergedIntoEventId`;

const ENGAGEMENT_COLUMNS = `g.id, g.department_id AS departmentId, g.event_id AS eventId,
  g.participant_kind AS kind, g.team_id AS teamId, t.name AS teamName, g.status,
  g.status_changed_at AS statusChangedAt, g.internal_notes AS notes, g.created_at AS createdAt,
  g.version`;

export class EngagementsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  event(id: string): EventRecord | undefined {
    return this.#db.raw.prepare(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = ?`).get(id) as
      EventRecord | undefined;
  }

  events(ids: readonly string[]): EventRecord[] {
    if (ids.length === 0) return [];
    return this.#db.raw
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id IN (${placeholders(ids)})`)
      .all(...ids) as EventRecord[];
  }

  /** The dates still ahead, per event, soonest first (§12's countdown). */
  upcomingDeadlines(eventIds: readonly string[], now: number): DeadlineRecord[] {
    if (eventIds.length === 0) return [];
    const list = placeholders(eventIds);
    return this.#db.raw
      .prepare(
        `SELECT event_id AS eventId, kind, due_at AS at, precision FROM event_deadlines
           WHERE event_id IN (${list}) AND due_at >= ?
         UNION ALL
         SELECT id, 'REGISTRATION', registration_deadline_at, registration_deadline_precision
           FROM events WHERE id IN (${list}) AND registration_deadline_at >= ?
         ORDER BY at`,
      )
      .all(...eventIds, now, ...eventIds, now) as DeadlineRecord[];
  }

  find(id: string): EngagementRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements g LEFT JOIN teams t ON t.id = g.team_id
         WHERE g.id = ?`,
      )
      .get(id) as EngagementRecord | undefined;
  }

  list(query: CompetitionQuery, actorId: string, now: number): EngagementRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (query.status !== undefined && query.status.length > 0) {
      where.push(`g.status IN (${placeholders(query.status)})`);
      args.push(...query.status);
    } else if (query.includeClosed !== true) {
      where.push(`g.status NOT IN ('WITHDRAWN', 'NOT_SELECTED')`);
    }
    if (query.teamId !== undefined) {
      where.push('g.team_id = ?');
      args.push(query.teamId);
    }
    if (query.eventId !== undefined) {
      where.push('g.event_id = ?');
      args.push(query.eventId);
    }
    if (query.studentId !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM engagement_participants p WHERE p.engagement_id = g.id AND p.student_id = ?)',
      );
      args.push(query.studentId);
    }
    if (query.mentorId !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM engagement_mentors m WHERE m.engagement_id = g.id AND m.user_id = ? AND m.to_at IS NULL)',
      );
      args.push(query.mentorId === 'me' ? actorId : query.mentorId);
    }
    if (query.eventTypes !== undefined && query.eventTypes.length > 0) {
      where.push(`e.event_type IN (${placeholders(query.eventTypes)})`);
      args.push(...query.eventTypes);
    }
    if (query.deadlineWithinDays !== undefined) {
      const until = now + query.deadlineWithinDays * 86_400_000;
      where.push(
        `(EXISTS (SELECT 1 FROM event_deadlines d WHERE d.event_id = g.event_id AND d.due_at BETWEEN ? AND ?)
          OR e.registration_deadline_at BETWEEN ? AND ?)`,
      );
      args.push(now, until, now, until);
    }
    return this.#db.raw
      .prepare(
        `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements g
         JOIN events e ON e.id = g.event_id
         LEFT JOIN teams t ON t.id = g.team_id
         ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
         ORDER BY g.status_changed_at DESC, g.id`,
      )
      .all(...args) as EngagementRecord[];
  }

  participants(engagementIds: readonly string[]): ParticipantRecord[] {
    if (engagementIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT p.engagement_id AS engagementId, p.student_id AS studentId, s.full_name AS fullName,
           s.university_id AS universityId, s.status AS studentStatus, s.erased_at AS erasedAt,
           p.role_label AS roleLabel, p.added_at AS addedAt, p.removed_at AS removedAt,
           p.removal_reason AS removalReason
         FROM engagement_participants p JOIN students s ON s.id = p.student_id
         WHERE p.engagement_id IN (${placeholders(engagementIds)})
         ORDER BY p.removed_at IS NOT NULL, lower(s.full_name), s.id`,
      )
      .all(...engagementIds) as ParticipantRecord[];
  }

  mentors(engagementIds: readonly string[]): CompetitionMentorRecord[] {
    if (engagementIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT m.id, m.engagement_id AS engagementId, m.user_id AS userId, u.display_name AS displayName,
           m.role, m.from_at AS fromAt, m.to_at AS toAt
         FROM engagement_mentors m JOIN users u ON u.id = m.user_id
         WHERE m.engagement_id IN (${placeholders(engagementIds)})
         ORDER BY m.to_at IS NOT NULL, m.role = 'CO_MENTOR', m.from_at, m.id`,
      )
      .all(...engagementIds) as CompetitionMentorRecord[];
  }

  openMentors(engagementId: string): CompetitionMentorRecord[] {
    return this.mentors([engagementId]).filter((row) => row.toAt === null);
  }

  history(engagementId: string): HistoryRecord[] {
    return this.#db.raw
      .prepare(
        `SELECT h.id, h.from_status AS fromStatus, h.to_status AS toStatus,
           u.display_name AS changedBy, h.changed_at AS changedAt, h.note
         FROM engagement_status_history h LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.engagement_id = ? ORDER BY h.changed_at, h.id`,
      )
      .all(engagementId) as HistoryRecord[];
  }

  /** A14: who among these students is already on an open roster for the event. */
  activeOn(eventId: string, studentIds: readonly string[]): ActiveParticipation[] {
    if (studentIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT p.student_id AS studentId, g.id AS engagementId, g.participant_kind AS kind,
           t.name AS teamName, s.full_name AS studentName, e.title AS eventTitle
         FROM engagement_participants p
         JOIN engagements g ON g.id = p.engagement_id
         JOIN events e ON e.id = g.event_id
         JOIN students s ON s.id = p.student_id
         LEFT JOIN teams t ON t.id = g.team_id
         WHERE p.event_id = ? AND p.removed_at IS NULL AND p.student_id IN (${placeholders(studentIds)})`,
      )
      .all(eventId, ...studentIds) as ActiveParticipation[];
  }

  /** R97: the team's competition on this event that still counts, if any. */
  openForTeam(eventId: string, teamId: string): EngagementRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements g LEFT JOIN teams t ON t.id = g.team_id
         WHERE g.event_id = ? AND g.team_id = ? AND g.status NOT IN ('WITHDRAWN', 'NOT_SELECTED')`,
      )
      .get(eventId, teamId) as EngagementRecord | undefined;
  }

  students(
    ids: readonly string[],
  ): Map<string, { fullName: string; universityId: string; erasedAt: number | null }> {
    if (ids.length === 0) return new Map();
    const rows = this.#db.raw
      .prepare(
        `SELECT id, full_name AS fullName, university_id AS universityId, erased_at AS erasedAt
         FROM students WHERE id IN (${placeholders(ids)})`,
      )
      .all(...ids) as {
      id: string;
      fullName: string;
      universityId: string;
      erasedAt: number | null;
    }[];
    return new Map(rows.map(({ id, ...rest }) => [id, rest]));
  }

  userName(id: string): string | undefined {
    const row = this.#db.raw
      .prepare('SELECT display_name AS name FROM users WHERE id = ?')
      .get(id) as { name: string } | undefined;
    return row?.name;
  }

  insert(row: {
    id: string;
    departmentId: string;
    eventId: string;
    kind: ParticipantKind;
    teamId: string | null;
    status: EngagementStatus;
    createdBy: string;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO engagements (id, department_id, event_id, participant_kind, team_id, status,
           status_changed_at, created_at, created_by, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        row.id,
        row.departmentId,
        row.eventId,
        row.kind,
        row.teamId,
        row.status,
        row.at,
        row.at,
        row.createdBy,
        row.at,
      );
  }

  /** Bumps the version (every write does) and applies the given column changes. */
  touch(
    id: string,
    at: number,
    change: { status?: EngagementStatus; notes?: string | null } = {},
  ): void {
    const sets = ['updated_at = ?', 'version = version + 1'];
    const args: unknown[] = [at];
    if (change.status !== undefined) {
      sets.push('status = ?', 'status_changed_at = ?');
      args.push(change.status, at);
    }
    if (change.notes !== undefined) {
      sets.push('internal_notes = ?');
      args.push(change.notes);
    }
    this.#db.raw.prepare(`UPDATE engagements SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }

  addHistory(row: {
    id: string;
    engagementId: string;
    from: EngagementStatus | null;
    to: EngagementStatus;
    by: string;
    at: number;
    note: string | null;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO engagement_status_history (id, engagement_id, from_status, to_status, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.engagementId, row.from, row.to, row.by, row.at, row.note);
  }

  /** Adds a student, or reopens his earlier row on this competition (R97). */
  openParticipant(row: {
    engagementId: string;
    studentId: string;
    eventId: string;
    roleLabel: string | null;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO engagement_participants (engagement_id, student_id, event_id, role_label, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (engagement_id, student_id) DO UPDATE SET
           role_label = excluded.role_label, added_at = excluded.added_at,
           removed_at = NULL, removal_reason = NULL`,
      )
      .run(row.engagementId, row.studentId, row.eventId, row.roleLabel, row.at);
  }

  closeParticipant(
    engagementId: string,
    studentId: string,
    at: number,
    reason: RemovalReason,
  ): void {
    this.#db.raw
      .prepare(
        `UPDATE engagement_participants SET removed_at = ?, removal_reason = ?
         WHERE engagement_id = ? AND student_id = ? AND removed_at IS NULL`,
      )
      .run(at, reason, engagementId, studentId);
  }

  /** R97: WITHDRAWN and NOT_SELECTED release the whole roster. */
  closeRoster(engagementId: string, at: number): number {
    return this.#db.raw
      .prepare(
        `UPDATE engagement_participants SET removed_at = ?, removal_reason = 'ENGAGEMENT_CLOSED'
         WHERE engagement_id = ? AND removed_at IS NULL`,
      )
      .run(at, engagementId).changes;
  }

  addMentor(row: {
    id: string;
    engagementId: string;
    userId: string;
    role: MentorRole;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO engagement_mentors (id, engagement_id, user_id, role, from_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.engagementId, row.userId, row.role, row.at);
  }

  endMentor(id: string, at: number): void {
    this.#db.raw
      .prepare('UPDATE engagement_mentors SET to_at = ? WHERE id = ? AND to_at IS NULL')
      .run(at, id);
  }
}
