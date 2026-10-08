import type { StudentTeam, TeamStatus } from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';

/**
 * The two things the students module needs to know about teams (WP-18 step 5):
 * a student's memberships, for the Student page, and the mentors of the ACTIVE
 * teams the student is in now, which complete §10.2's deactivate rule.
 */
export class TeamLinksRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** Open memberships first (by team name), then past ones, newest first. */
  teamsOf(studentId: string): StudentTeam[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT t.id AS teamId, t.name AS teamName, t.status AS teamStatus, m.role_label AS roleLabel,
           m.is_lead AS isLead, m.joined_at AS joinedAt, m.left_at AS leftAt
         FROM team_members m JOIN teams t ON t.id = m.team_id
         WHERE m.student_id = ?
         ORDER BY m.left_at IS NOT NULL, m.left_at DESC, lower(t.name), m.id`,
      )
      .all(studentId) as {
      teamId: string;
      teamName: string;
      teamStatus: TeamStatus;
      roleLabel: string | null;
      isLead: number;
      joinedAt: number;
      leftAt: number | null;
    }[];
    return rows.map((row) => ({
      ...row,
      isLead: row.isLead === 1,
      joinedAt: new Date(row.joinedAt).toISOString(),
      leftAt: row.leftAt === null ? null : new Date(row.leftAt).toISOString(),
    }));
  }

  /** Open PRIMARY/CO_MENTOR users of ACTIVE teams with an open membership of the student. */
  teamMentorUserIds(studentId: string): string[] {
    return (
      this.#db.raw
        .prepare(
          `SELECT DISTINCT mt.user_id AS id FROM team_members m
           JOIN teams t ON t.id = m.team_id AND t.status = 'ACTIVE'
           JOIN team_mentors mt ON mt.team_id = t.id AND mt.to_at IS NULL
           WHERE m.student_id = ? AND m.left_at IS NULL`,
        )
        .all(studentId) as { id: string }[]
    ).map((row) => row.id);
  }

  /** Open memberships per student, for the list. */
  openTeamCounts(studentIds: readonly string[]): Map<string, number> {
    if (studentIds.length === 0) return new Map();
    const rows = this.#db.raw
      .prepare(
        `SELECT student_id AS id, count(*) AS n FROM team_members
         WHERE left_at IS NULL AND student_id IN (${studentIds.map(() => '?').join(', ')})
         GROUP BY student_id`,
      )
      .all(...studentIds) as { id: string; n: number }[];
    return new Map(rows.map((row) => [row.id, row.n]));
  }
}
