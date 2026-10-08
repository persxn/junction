import type { EngagementStatus, MentorRole, RoleKey, TeamStatus } from '@compintel/contracts';

import type {
  CompetitionInput,
  MentorRow,
  MentorshipInput,
  TeamInput,
} from '../../domain/transfer/plan.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * SQL for an ownership transfer (WP-21, R105): the *from* professor's active
 * rows with their parents, and the writes the plan asks for. Nothing here
 * decides anything — `domain/transfer/plan.ts` does.
 */

export interface TransferUser {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
  readonly roles: readonly RoleKey[];
}

const ERASED = 'Erased student';

export class TransferRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  user(id: string): TransferUser | undefined {
    const row = this.#db.raw
      .prepare('SELECT id, display_name AS displayName, status FROM users WHERE id = ?')
      .get(id) as Omit<TransferUser, 'roles'> | undefined;
    if (row === undefined) return undefined;
    const roles = (
      this.#db.raw
        .prepare(
          'SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?',
        )
        .all(id) as { key: RoleKey }[]
    ).map((role) => role.key);
    return { ...row, roles };
  }

  #mentors(table: 'team_mentors' | 'engagement_mentors', column: string, ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, MentorRow[]>();
    const rows = this.#db.raw
      .prepare(
        `SELECT id, ${column} AS parentId, user_id AS userId, role FROM ${table}
         WHERE to_at IS NULL AND ${column} IN (${ids.map(() => '?').join(', ')}) ORDER BY id`,
      )
      .all(...ids) as (MentorRow & { parentId: string })[];
    const byParent = new Map<string, MentorRow[]>();
    for (const { parentId, ...row } of rows) {
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), row]);
    }
    return byParent;
  }

  /** Teams where `userId` holds an active mentor row, with all their active rows. */
  teamsOf(userId: string): TeamInput[] {
    const teams = this.#db.raw
      .prepare(
        `SELECT t.id, t.name, t.status, t.version FROM teams t
         WHERE EXISTS (SELECT 1 FROM team_mentors m WHERE m.team_id = t.id AND m.user_id = ? AND m.to_at IS NULL)
         ORDER BY t.name, t.id`,
      )
      .all(userId) as { id: string; name: string; status: TeamStatus; version: number }[];
    const mentors = this.#mentors(
      'team_mentors',
      'team_id',
      teams.map((team) => team.id),
    );
    return teams.map((team) => ({ ...team, mentors: mentors.get(team.id) ?? [] }));
  }

  /** Competitions where `userId` holds an active mentor row, named "who — event". */
  competitionsOf(userId: string): CompetitionInput[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT e.id, e.status, e.version, ev.title AS eventTitle, t.name AS teamName,
           (SELECT CASE WHEN s.erased_at IS NULL THEN s.full_name ELSE '${ERASED}' END
              FROM engagement_participants p JOIN students s ON s.id = p.student_id
              WHERE p.engagement_id = e.id ORDER BY p.added_at LIMIT 1) AS studentName
         FROM engagements e
         JOIN events ev ON ev.id = e.event_id
         LEFT JOIN teams t ON t.id = e.team_id
         WHERE EXISTS (SELECT 1 FROM engagement_mentors m
                       WHERE m.engagement_id = e.id AND m.user_id = ? AND m.to_at IS NULL)
         ORDER BY ev.title, e.id`,
      )
      .all(userId) as {
      id: string;
      status: EngagementStatus;
      version: number;
      eventTitle: string;
      teamName: string | null;
      studentName: string | null;
    }[];
    const mentors = this.#mentors(
      'engagement_mentors',
      'engagement_id',
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      version: row.version,
      name: `${row.teamName ?? row.studentName ?? 'Individual'} — ${row.eventTitle}`,
      mentors: mentors.get(row.id) ?? [],
    }));
  }

  /** `userId`'s open mentorships. */
  mentorshipsOf(userId: string): MentorshipInput[] {
    return this.#db.raw
      .prepare(
        `SELECT m.id, m.student_id AS studentId, m.mentor_user_id AS mentorUserId,
           CASE WHEN s.erased_at IS NULL THEN s.full_name ELSE '${ERASED}' END AS studentName
         FROM mentorships m JOIN students s ON s.id = m.student_id
         WHERE m.mentor_user_id = ? AND m.ended_at IS NULL ORDER BY m.id`,
      )
      .all(userId) as MentorshipInput[];
  }

  /** The students `userId` already mentors (open rows). */
  menteesOf(userId: string): Set<string> {
    return new Set(
      (
        this.#db.raw
          .prepare(
            'SELECT student_id AS id FROM mentorships WHERE mentor_user_id = ? AND ended_at IS NULL',
          )
          .all(userId) as { id: string }[]
      ).map((row) => row.id),
    );
  }

  close(
    table: 'team_mentors' | 'engagement_mentors' | 'mentorships',
    rowId: string,
    at: number,
  ): void {
    const column = table === 'mentorships' ? 'ended_at' : 'to_at';
    this.#db.raw
      .prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} IS NULL`)
      .run(at, rowId);
  }

  openTeamMentor(teamId: string, userId: string, role: MentorRole, at: number): void {
    this.#db.raw
      .prepare(
        'INSERT INTO team_mentors (id, team_id, user_id, role, from_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(uuid7(), teamId, userId, role, at);
  }

  openCompetitionMentor(engagementId: string, userId: string, role: MentorRole, at: number): void {
    this.#db.raw
      .prepare(
        'INSERT INTO engagement_mentors (id, engagement_id, user_id, role, from_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(uuid7(), engagementId, userId, role, at);
  }

  openMentorship(studentId: string, userId: string, at: number, by: string): void {
    this.#db.raw
      .prepare(
        `INSERT INTO mentorships (id, mentor_user_id, student_id, started_at, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(uuid7(), userId, studentId, at, by);
  }

  /** R105: an edit in flight elsewhere gets its own 409. */
  bumpTeam(id: string, at: number): void {
    this.#db.raw
      .prepare('UPDATE teams SET version = version + 1, updated_at = ? WHERE id = ?')
      .run(at, id);
  }

  bumpCompetition(id: string, at: number): void {
    this.#db.raw
      .prepare('UPDATE engagements SET version = version + 1, updated_at = ? WHERE id = ?')
      .run(at, id);
  }
}
