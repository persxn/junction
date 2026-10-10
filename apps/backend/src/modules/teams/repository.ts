import type { MentorRole, StudentStatus, TeamListQuery, TeamStatus } from '@compintel/contracts';
import { MENTOR_ROLE_KEYS } from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';

/**
 * Every SQL statement about teams (WP-18 ground rules: SQL only in
 * repositories). Rows are opened and closed, never deleted (R95); the one
 * exception is the target list, which is a setting, not history.
 */

const placeholders = (values: readonly unknown[]): string => values.map(() => '?').join(', ');

export interface TeamRecord {
  readonly id: string;
  readonly departmentId: string;
  readonly name: string;
  readonly nameKey: string;
  readonly description: string | null;
  readonly status: TeamStatus;
  readonly createdAt: number;
  readonly version: number;
}

export interface TeamListRow {
  readonly id: string;
  readonly name: string;
  readonly status: TeamStatus;
  readonly memberCount: number;
  readonly primaryUserId: string | null;
  readonly primaryName: string | null;
  readonly mine: number;
  readonly version: number;
}

export interface MemberRecord {
  readonly id: string;
  readonly teamId: string;
  readonly studentId: string;
  readonly fullName: string;
  readonly universityId: string;
  readonly studentStatus: StudentStatus;
  readonly erasedAt: number | null;
  readonly roleLabel: string | null;
  readonly isLead: number;
  readonly joinedAt: number;
  readonly leftAt: number | null;
}

export interface MentorRecord {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: MentorRole;
  readonly fromAt: number;
  readonly toAt: number | null;
}

export interface SkillHolding {
  readonly studentId: string;
  readonly name: string;
  readonly proficiency: number | null;
}

export class TeamsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** Teams belong to the managing department (one department in the pilot). */
  managingDepartmentId(): string | undefined {
    const row = this.#db.raw
      .prepare('SELECT id FROM departments ORDER BY is_managing DESC, created_at LIMIT 1')
      .get() as { id: string } | undefined;
    return row?.id;
  }

  find(id: string): TeamRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT id, department_id AS departmentId, name, name_key AS nameKey, description, status,
           created_at AS createdAt, version FROM teams WHERE id = ?`,
      )
      .get(id) as TeamRecord | undefined;
  }

  /** Another ACTIVE team of the department already holds this name (R95). */
  nameTaken(departmentId: string, nameKey: string, exceptId: string | null): boolean {
    const row = this.#db.raw
      .prepare(
        `SELECT 1 FROM teams WHERE department_id = ? AND name_key = ? AND status = 'ACTIVE'
           AND id IS NOT ?`,
      )
      .get(departmentId, nameKey, exceptId);
    return row !== undefined;
  }

  list(query: TeamListQuery, actorId: string): TeamListRow[] {
    const where: string[] = [];
    const args: unknown[] = [actorId];
    if (query.text !== undefined && query.text !== '') {
      where.push("t.name_key LIKE ? ESCAPE '\\'");
      args.push(`%${query.text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (query.status !== undefined) {
      where.push('t.status = ?');
      args.push(query.status);
    }
    if (query.mentor !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM team_mentors m WHERE m.team_id = t.id AND m.user_id = ? AND m.to_at IS NULL)',
      );
      args.push(query.mentor === 'me' ? actorId : query.mentor);
    }
    if (query.studentId !== undefined) {
      where.push(
        'EXISTS (SELECT 1 FROM team_members x WHERE x.team_id = t.id AND x.student_id = ? AND x.left_at IS NULL)',
      );
      args.push(query.studentId);
    }
    return this.#db.raw
      .prepare(
        `SELECT t.id, t.name, t.status, t.version,
           (SELECT count(*) FROM team_members x WHERE x.team_id = t.id AND x.left_at IS NULL) AS memberCount,
           p.user_id AS primaryUserId, u.display_name AS primaryName,
           EXISTS (SELECT 1 FROM team_mentors m WHERE m.team_id = t.id AND m.user_id = ? AND m.to_at IS NULL) AS mine
         FROM teams t
         LEFT JOIN team_mentors p ON p.team_id = t.id AND p.role = 'PRIMARY' AND p.to_at IS NULL
         LEFT JOIN users u ON u.id = p.user_id
         ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
         ORDER BY t.status, t.name_key, t.id`,
      )
      .all(...args) as TeamListRow[];
  }

  insert(team: TeamRecord & { readonly createdBy: string }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO teams (id, department_id, name, name_key, description, status, created_at,
           created_by, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        team.id,
        team.departmentId,
        team.name,
        team.nameKey,
        team.description,
        team.status,
        team.createdAt,
        team.createdBy,
        team.createdAt,
      );
  }

  /** Writes the changed columns and bumps `version` — every team write goes through here. */
  touch(
    id: string,
    at: number,
    patch: {
      name?: string;
      nameKey?: string;
      description?: string | null;
      status?: TeamStatus;
    } = {},
  ): void {
    const columns: [string, unknown][] = [
      ['name', patch.name],
      ['name_key', patch.nameKey],
      ['description', patch.description],
      ['status', patch.status],
    ];
    const changed = columns.filter(([, value]) => value !== undefined);
    const sets = [
      'updated_at = ?',
      'version = version + 1',
      ...changed.map(([column]) => `${column} = ?`),
    ];
    this.#db.raw
      .prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`)
      .run(at, ...changed.map(([, value]) => value), id);
  }

  members(teamIds: readonly string[]): MemberRecord[] {
    if (teamIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT m.id, m.team_id AS teamId, m.student_id AS studentId, s.full_name AS fullName,
           s.university_id AS universityId, s.status AS studentStatus, s.erased_at AS erasedAt,
           m.role_label AS roleLabel, m.is_lead AS isLead, m.joined_at AS joinedAt, m.left_at AS leftAt
         FROM team_members m JOIN students s ON s.id = m.student_id
         WHERE m.team_id IN (${placeholders(teamIds)})
         ORDER BY m.left_at IS NOT NULL, m.is_lead DESC, lower(s.full_name), m.id`,
      )
      .all(...teamIds) as MemberRecord[];
  }

  member(id: string): MemberRecord | undefined {
    const row = this.#db.raw
      .prepare('SELECT team_id AS teamId FROM team_members WHERE id = ?')
      .get(id) as { teamId: string } | undefined;
    return row === undefined
      ? undefined
      : this.members([row.teamId]).find((member) => member.id === id);
  }

  openMembership(teamId: string, studentId: string): boolean {
    return (
      this.#db.raw
        .prepare(
          'SELECT 1 FROM team_members WHERE team_id = ? AND student_id = ? AND left_at IS NULL',
        )
        .get(teamId, studentId) !== undefined
    );
  }

  addMember(row: {
    id: string;
    teamId: string;
    studentId: string;
    roleLabel: string | null;
    isLead: boolean;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO team_members (id, team_id, student_id, role_label, is_lead, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.teamId, row.studentId, row.roleLabel, row.isLead ? 1 : 0, row.at);
  }

  /** Clears the open lead, so a new one can be set in the same transaction. */
  clearLead(teamId: string): void {
    this.#db.raw
      .prepare('UPDATE team_members SET is_lead = 0 WHERE team_id = ? AND left_at IS NULL')
      .run(teamId);
  }

  updateMember(id: string, patch: { roleLabel?: string | null; isLead?: boolean }): void {
    if (patch.roleLabel !== undefined) {
      this.#db.raw
        .prepare('UPDATE team_members SET role_label = ? WHERE id = ?')
        .run(patch.roleLabel, id);
    }
    if (patch.isLead !== undefined) {
      this.#db.raw
        .prepare('UPDATE team_members SET is_lead = ? WHERE id = ?')
        .run(patch.isLead ? 1 : 0, id);
    }
  }

  leave(id: string, at: number): void {
    this.#db.raw
      .prepare('UPDATE team_members SET left_at = ? WHERE id = ? AND left_at IS NULL')
      .run(at, id);
  }

  mentors(teamIds: readonly string[]): MentorRecord[] {
    if (teamIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT m.id, m.team_id AS teamId, m.user_id AS userId, u.display_name AS displayName, m.role,
           m.from_at AS fromAt, m.to_at AS toAt
         FROM team_mentors m JOIN users u ON u.id = m.user_id
         WHERE m.team_id IN (${placeholders(teamIds)})
         ORDER BY m.to_at IS NOT NULL, m.role DESC, m.from_at, m.id`,
      )
      .all(...teamIds) as MentorRecord[];
  }

  openMentors(teamId: string): MentorRecord[] {
    return this.mentors([teamId]).filter((row) => row.toAt === null);
  }

  addMentor(row: {
    id: string;
    teamId: string;
    userId: string;
    role: MentorRole;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        'INSERT INTO team_mentors (id, team_id, user_id, role, from_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(row.id, row.teamId, row.userId, row.role, row.at);
  }

  endMentor(id: string, at: number): void {
    this.#db.raw
      .prepare('UPDATE team_mentors SET to_at = ? WHERE id = ? AND to_at IS NULL')
      .run(at, id);
  }

  targets(teamId: string): string[] {
    return (
      this.#db.raw
        .prepare(
          `SELECT t.name FROM team_skill_targets x JOIN tags t ON t.id = x.tag_id
           WHERE x.team_id = ? ORDER BY t.normalized`,
        )
        .all(teamId) as { name: string }[]
    ).map((row) => row.name);
  }

  setTargets(teamId: string, tagIds: readonly string[]): void {
    this.#db.raw.prepare('DELETE FROM team_skill_targets WHERE team_id = ?').run(teamId);
    const insert = this.#db.raw.prepare(
      'INSERT OR IGNORE INTO team_skill_targets (team_id, tag_id) VALUES (?, ?)',
    );
    for (const tagId of tagIds) insert.run(teamId, tagId);
  }

  /** The SKILL tags the given students hold, for coverage (R94). */
  skillsOf(studentIds: readonly string[]): SkillHolding[] {
    if (studentIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT st.student_id AS studentId, t.name, st.proficiency FROM student_tags st
         JOIN tags t ON t.id = st.tag_id
         WHERE st.relation = 'SKILL' AND st.student_id IN (${placeholders(studentIds)})
         ORDER BY t.normalized`,
      )
      .all(...studentIds) as SkillHolding[];
  }

  /**
   * ACTIVE accounts that can own a team — PROFESSOR, or STUDENT on a student
   * install (R131's MENTOR_ROLE_KEYS) — for the pickers and R95's mentor rule.
   */
  professors(): { userId: string; displayName: string }[] {
    const keys = MENTOR_ROLE_KEYS.map(() => '?').join(', ');
    return this.#db.raw
      .prepare(
        `SELECT DISTINCT u.id AS userId, u.display_name AS displayName FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE r.key IN (${keys}) AND u.status = 'ACTIVE' ORDER BY lower(u.display_name), u.id`,
      )
      .all(...MENTOR_ROLE_KEYS) as { userId: string; displayName: string }[];
  }

  isActiveProfessor(userId: string): boolean {
    return this.professors().some((row) => row.userId === userId);
  }

  studentStatus(studentId: string): { status: StudentStatus; erasedAt: number | null } | undefined {
    return this.#db.raw
      .prepare('SELECT status, erased_at AS erasedAt FROM students WHERE id = ?')
      .get(studentId) as { status: StudentStatus; erasedAt: number | null } | undefined;
  }
}
