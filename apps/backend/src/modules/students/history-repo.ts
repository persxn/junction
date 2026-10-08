import type {
  DatePrecision,
  EngagementStatus,
  OutcomeResult,
  StudentHistory,
} from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';

/** SQL for a student's history (WP-21): the tables that already exist, nothing new. */

export class StudentHistoryRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  student(id: string): { id: string; erasedAt: number | null } | undefined {
    return this.#db.raw
      .prepare('SELECT id, erased_at AS erasedAt FROM students WHERE id = ?')
      .get(id) as { id: string; erasedAt: number | null } | undefined;
  }

  competitions(studentId: string) {
    return this.#db.raw
      .prepare(
        `SELECT e.id AS competitionId, ev.title AS eventTitle, ev.starts_at AS startsAt,
           ev.ends_at AS endsAt, ev.date_precision AS datePrecision, t.name AS teamName,
           e.status, p.added_at AS addedAt, p.removed_at AS removedAt,
           o.result, o.rank, o.prize_text AS prizeText, o.prize_minor AS prizeMinor,
           o.prize_currency AS prizeCurrency, o.recorded_at AS recordedAt
         FROM engagement_participants p
         JOIN engagements e ON e.id = p.engagement_id
         JOIN events ev ON ev.id = e.event_id
         LEFT JOIN teams t ON t.id = e.team_id
         LEFT JOIN engagement_outcomes o ON o.engagement_id = e.id
         WHERE p.student_id = ?
         ORDER BY p.added_at DESC, e.id DESC`,
      )
      .all(studentId) as {
      competitionId: string;
      eventTitle: string;
      startsAt: number | null;
      endsAt: number | null;
      datePrecision: DatePrecision;
      teamName: string | null;
      status: EngagementStatus;
      addedAt: number;
      removedAt: number | null;
      result: OutcomeResult | null;
      rank: number | null;
      prizeText: string | null;
      prizeMinor: number | null;
      prizeCurrency: string | null;
      recordedAt: number | null;
    }[];
  }

  teams(studentId: string) {
    return this.#db.raw
      .prepare(
        `SELECT m.team_id AS teamId, t.name AS teamName, m.joined_at AS joinedAt, m.left_at AS leftAt,
           m.is_lead AS isLead, m.role_label AS roleLabel
         FROM team_members m JOIN teams t ON t.id = m.team_id
         WHERE m.student_id = ?
         ORDER BY m.joined_at DESC, m.id DESC`,
      )
      .all(studentId) as {
      teamId: string;
      teamName: string;
      joinedAt: number;
      leftAt: number | null;
      isLead: number;
      roleLabel: string | null;
    }[];
  }

  achievements(studentId: string) {
    return this.#db.raw
      .prepare(
        `SELECT id, title, event_name AS eventName, year, result, url, notes
         FROM student_achievements WHERE student_id = ?
         ORDER BY year IS NULL, year DESC, created_at DESC, id DESC`,
      )
      .all(studentId) as StudentHistory['achievements'];
  }
}
