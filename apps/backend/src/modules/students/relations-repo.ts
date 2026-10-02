import type { Proficiency, TagRelation } from '@compintel/contracts';

import { normalizeTag } from '../categories/domain/text.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * A student's skills and interests, mentorships and achievements (§6.2, R91).
 *
 * Tags are shared rows in `tags`: a student's skill is kind SKILL, an interest
 * kind INTEREST, one row per normalized name and kind, created on first use.
 * R87's event tags are TECHNOLOGY/THEME rows of the same names; anything that
 * compares the two compares `normalized`, never ids.
 */

export interface StudentTagRef {
  readonly tagId: string;
  readonly name: string;
  readonly normalized: string;
  readonly relation: TagRelation;
  readonly proficiency: Proficiency | null;
}

export interface MentorshipRef {
  readonly id: string;
  readonly mentorUserId: string;
  readonly mentorName: string;
  readonly studentId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly note: string | null;
}

export interface AchievementRow {
  readonly id: string;
  readonly studentId: string;
  readonly title: string;
  readonly eventName: string | null;
  readonly year: number | null;
  readonly result: string | null;
  readonly url: string | null;
  readonly notes: string | null;
}

export type AchievementFields = Omit<AchievementRow, 'id' | 'studentId'>;

const KIND_OF: Readonly<Record<TagRelation, 'SKILL' | 'INTEREST'>> = {
  SKILL: 'SKILL',
  INTEREST: 'INTEREST',
};

const placeholders = (values: readonly unknown[]): string => values.map(() => '?').join(', ');

export class RelationsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  // ---- Tags -------------------------------------------------------------------------

  /** The tag row for a name, created (normalized) when it does not exist yet. */
  ensureTag(relation: TagRelation, name: string, at: number): string {
    const kind = KIND_OF[relation];
    const normalized = normalizeTag(name);
    this.#db.raw
      .prepare(
        `INSERT INTO tags (id, kind, name, normalized, aliases_json, created_at)
         VALUES (?, ?, ?, ?, '[]', ?) ON CONFLICT (kind, normalized) DO NOTHING`,
      )
      .run(uuid7(), kind, name.trim().replace(/\s+/g, ' '), normalized, at);
    const row = this.#db.raw
      .prepare('SELECT id FROM tags WHERE kind = ? AND normalized = ?')
      .get(kind, normalized) as { id: string };
    return row.id;
  }

  /** Each student's tags: skills first, then interests, each by name. */
  tagsByStudent(studentIds: readonly string[]): [string, StudentTagRef[]][] {
    if (studentIds.length === 0) return [];
    const rows = this.#db.raw
      .prepare(
        `SELECT st.student_id AS studentId, t.id AS tagId, t.name, t.normalized, st.relation,
           st.proficiency FROM student_tags st JOIN tags t ON t.id = st.tag_id
         WHERE st.student_id IN (${placeholders(studentIds)})
         ORDER BY st.relation DESC, t.normalized`,
      )
      .all(...studentIds) as (StudentTagRef & { studentId: string })[];
    const out = new Map<string, StudentTagRef[]>(studentIds.map((id) => [id, []]));
    for (const { studentId, ...tag } of rows) out.get(studentId)?.push(tag);
    return [...out];
  }

  /** Replaces the whole set. */
  replaceTags(
    studentId: string,
    tags: readonly { tagId: string; relation: TagRelation; proficiency: Proficiency | null }[],
  ): void {
    this.#db.raw.prepare('DELETE FROM student_tags WHERE student_id = ?').run(studentId);
    const insert = this.#db.raw.prepare(
      'INSERT OR REPLACE INTO student_tags (student_id, tag_id, relation, proficiency) VALUES (?, ?, ?, ?)',
    );
    for (const tag of tags) insert.run(studentId, tag.tagId, tag.relation, tag.proficiency);
  }

  /** R93: an import only adds. An existing tag keeps its proficiency. */
  addTag(
    studentId: string,
    tagId: string,
    relation: TagRelation,
    proficiency: Proficiency | null,
  ): void {
    this.#db.raw
      .prepare(
        'INSERT OR IGNORE INTO student_tags (student_id, tag_id, relation, proficiency) VALUES (?, ?, ?, ?)',
      )
      .run(studentId, tagId, relation, proficiency);
  }

  /** The typeahead: names starting with the text first, then containing it. */
  suggestTags(kinds: readonly string[], text: string, limit = 12): { id: string; name: string }[] {
    const key = normalizeTag(text);
    return this.#db.raw
      .prepare(
        `SELECT min(id) AS id, name FROM tags WHERE kind IN (${placeholders(kinds)})
           AND normalized LIKE ? ESCAPE '\\'
         GROUP BY normalized
         ORDER BY (normalized LIKE ? ESCAPE '\\') DESC, normalized LIMIT ?`,
      )
      .all(
        ...kinds,
        `%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
        `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
        limit,
      ) as { id: string; name: string }[];
  }

  // ---- Mentorships --------------------------------------------------------------------

  mentorshipsOf(studentIds: readonly string[]): MentorshipRef[] {
    if (studentIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT m.id, m.mentor_user_id AS mentorUserId, u.display_name AS mentorName,
           m.student_id AS studentId, m.started_at AS startedAt, m.ended_at AS endedAt, m.note
         FROM mentorships m JOIN users u ON u.id = m.mentor_user_id
         WHERE m.student_id IN (${placeholders(studentIds)})
         ORDER BY m.ended_at IS NOT NULL, m.started_at`,
      )
      .all(...studentIds) as MentorshipRef[];
  }

  mentorship(id: string): MentorshipRef | undefined {
    return this.#db.raw
      .prepare(
        `SELECT m.id, m.mentor_user_id AS mentorUserId, u.display_name AS mentorName,
           m.student_id AS studentId, m.started_at AS startedAt, m.ended_at AS endedAt, m.note
         FROM mentorships m JOIN users u ON u.id = m.mentor_user_id WHERE m.id = ?`,
      )
      .get(id) as MentorshipRef | undefined;
  }

  openMentorUserIds(studentId: string): string[] {
    return (
      this.#db.raw
        .prepare(
          'SELECT mentor_user_id AS id FROM mentorships WHERE student_id = ? AND ended_at IS NULL',
        )
        .all(studentId) as { id: string }[]
    ).map((row) => row.id);
  }

  startMentorship(input: {
    mentorUserId: string;
    studentId: string;
    note: string | null;
    createdBy: string;
    at: number;
  }): string {
    const id = uuid7();
    this.#db.raw
      .prepare(
        `INSERT INTO mentorships (id, mentor_user_id, student_id, started_at, ended_at, note, created_by)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, input.mentorUserId, input.studentId, input.at, input.note, input.createdBy);
    return id;
  }

  endMentorship(id: string, at: number): boolean {
    return (
      this.#db.raw
        .prepare('UPDATE mentorships SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
        .run(at, id).changes === 1
    );
  }

  isActiveUser(userId: string): boolean {
    const row = this.#db.raw.prepare('SELECT status FROM users WHERE id = ?').get(userId) as
      { status: string } | undefined;
    return row?.status === 'ACTIVE';
  }

  // ---- Achievements -------------------------------------------------------------------

  achievementsOf(studentId: string): AchievementRow[] {
    return this.#db.raw
      .prepare(
        `SELECT id, student_id AS studentId, title, event_name AS eventName, year, result, url, notes
         FROM student_achievements WHERE student_id = ? ORDER BY year DESC, created_at DESC`,
      )
      .all(studentId) as AchievementRow[];
  }

  achievement(id: string): AchievementRow | undefined {
    return this.#db.raw
      .prepare(
        `SELECT id, student_id AS studentId, title, event_name AS eventName, year, result, url, notes
         FROM student_achievements WHERE id = ?`,
      )
      .get(id) as AchievementRow | undefined;
  }

  insertAchievement(
    studentId: string,
    fields: AchievementFields,
    createdBy: string,
    at: number,
  ): string {
    const id = uuid7();
    this.#db.raw
      .prepare(
        `INSERT INTO student_achievements (id, student_id, title, event_name, year, result, url, notes,
           created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        studentId,
        fields.title,
        fields.eventName,
        fields.year,
        fields.result,
        fields.url,
        fields.notes,
        at,
        createdBy,
      );
    return id;
  }

  updateAchievement(id: string, fields: AchievementFields): void {
    this.#db.raw
      .prepare(
        `UPDATE student_achievements SET title = ?, event_name = ?, year = ?, result = ?, url = ?, notes = ?
         WHERE id = ?`,
      )
      .run(
        fields.title,
        fields.eventName,
        fields.year,
        fields.result,
        fields.url,
        fields.notes,
        id,
      );
  }

  deleteAchievement(id: string): void {
    this.#db.raw.prepare('DELETE FROM student_achievements WHERE id = ?').run(id);
  }

  // ---- Erasure (R92) ------------------------------------------------------------------

  /** Tags, achievements and mentorships go; the caller anonymizes the row itself. */
  eraseRelations(studentId: string): void {
    this.#db.raw.prepare('DELETE FROM student_tags WHERE student_id = ?').run(studentId);
    this.#db.raw.prepare('DELETE FROM student_achievements WHERE student_id = ?').run(studentId);
    this.#db.raw.prepare('DELETE FROM mentorships WHERE student_id = ?').run(studentId);
  }
}
