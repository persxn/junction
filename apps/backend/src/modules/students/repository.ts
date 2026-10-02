import type { StudentListQuery, StudentProgram, StudentStatus } from '@compintel/contracts';
import { and, eq, sql } from 'drizzle-orm';

import { students, type StudentRow } from '../../db/schema/index.js';
import { normalizeTag } from '../categories/domain/text.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * Reads and writes for `students` (§6.2 "People", WP-17). Tags, mentorships and
 * achievements are next door in `relations-repo.ts`. SQL lives here and nowhere
 * else in the module; the service decides, this file does what it is told.
 */

export type NewStudent = Omit<StudentRow, 'erasedAt' | 'version'>;

export type StudentPatch = Partial<
  Pick<
    StudentRow,
    | 'universityId'
    | 'universityIdKey'
    | 'fullName'
    | 'preferredName'
    | 'institutionalEmail'
    | 'phone'
    | 'homeDepartmentId'
    | 'program'
    | 'branch'
    | 'graduationYear'
    | 'isExternal'
    | 'externalInstitution'
    | 'notes'
    | 'privacyNoticeAckAt'
    | 'status'
  >
>;

export interface DepartmentOption {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly isManaging: boolean;
}

/** One row of the list, before the per-page lookups. */
export interface ListRow {
  readonly id: string;
  readonly universityId: string;
  readonly fullName: string;
  readonly preferredName: string | null;
  readonly institutionalEmail: string | null;
  readonly program: StudentProgram;
  readonly branch: string | null;
  readonly graduationYear: number | null;
  readonly status: StudentStatus;
  readonly isExternal: number;
  readonly homeDepartmentName: string | null;
  readonly erasedAt: number | null;
  readonly version: number;
  readonly total: number;
}

/** The list's keyset: name (case-folded), then id. */
export interface ListCursor {
  readonly name: string;
  readonly id: string;
}

const like = (text: string): string => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class StudentsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  get raw(): DatabaseHandle['raw'] {
    return this.#db.raw;
  }

  /** The one organization this installation serves (Q1: standalone). */
  organizationId(): string | undefined {
    const row = this.#db.raw
      .prepare('SELECT id FROM organizations ORDER BY created_at LIMIT 1')
      .get() as { id: string } | undefined;
    return row?.id;
  }

  departments(organizationId: string): DepartmentOption[] {
    return (
      this.#db.raw
        .prepare(
          `SELECT id, name, code, is_managing AS isManaging FROM departments
           WHERE organization_id = ? ORDER BY is_managing DESC, name`,
        )
        .all(organizationId) as (Omit<DepartmentOption, 'isManaging'> & { isManaging: number })[]
    ).map((row) => ({ ...row, isManaging: row.isManaging === 1 }));
  }

  findById(id: string): StudentRow | undefined {
    return this.#db.drizzle.select().from(students).where(eq(students.id, id)).get();
  }

  findByKey(organizationId: string, key: string): StudentRow | undefined {
    return this.#db.drizzle
      .select()
      .from(students)
      .where(and(eq(students.organizationId, organizationId), eq(students.universityIdKey, key)))
      .get();
  }

  /** Every live student of the organization — the import's snapshot (R93). */
  allLive(organizationId: string): StudentRow[] {
    return this.#db.drizzle
      .select()
      .from(students)
      .where(and(eq(students.organizationId, organizationId), sql`${students.erasedAt} is null`))
      .all();
  }

  insert(row: NewStudent): StudentRow {
    this.#db.drizzle.insert(students).values(row).run();
    const stored = this.findById(row.id);
    if (stored === undefined) throw new Error('a student vanished on insert');
    return stored;
  }

  /**
   * Applies a patch if `expectedVersion` still matches, bumping `version`.
   * `false` means somebody else got there first (§6.1).
   */
  update(id: string, patch: StudentPatch, expectedVersion: number, at: number): boolean {
    return (
      this.#db.drizzle
        .update(students)
        .set({ ...patch, updatedAt: at, version: sql`${students.version} + 1` })
        .where(and(eq(students.id, id), eq(students.version, expectedVersion)))
        .run().changes === 1
    );
  }

  /** Bumps `version` for a change held in another table (tags), version-checked. */
  touch(id: string, expectedVersion: number, at: number): boolean {
    return this.update(id, {}, expectedVersion, at);
  }

  /**
   * R92: the personal columns go, the row stays. Run inside the caller's audited
   * transaction together with `RelationsRepository.eraseRelations`.
   */
  anonymize(id: string, at: number): void {
    this.#db.drizzle
      .update(students)
      .set({
        fullName: 'Erased student',
        universityId: `ERASED-${id}`,
        universityIdKey: `ERASED-${id}`.toUpperCase(),
        preferredName: null,
        institutionalEmail: null,
        phone: null,
        branch: null,
        graduationYear: null,
        externalInstitution: null,
        notes: null,
        privacyNoticeAckAt: null,
        status: 'INACTIVE',
        erasedAt: at,
        updatedAt: at,
        version: sql`${students.version} + 1`,
      })
      .where(eq(students.id, id))
      .run();
  }

  /** One page of the list, `limit + 1` rows so the caller knows if there is more. */
  list(
    organizationId: string,
    query: StudentListQuery,
    actorId: string,
    after: ListCursor | undefined,
  ): ListRow[] {
    const where: string[] = ['s.organization_id = ?', 's.erased_at IS NULL'];
    const params: unknown[] = [organizationId];
    const text = query.text?.trim();
    if (text !== undefined && text.length > 0) {
      where.push(
        `(s.full_name LIKE ? ESCAPE '\\' OR s.preferred_name LIKE ? ESCAPE '\\'
          OR s.university_id LIKE ? ESCAPE '\\' OR s.institutional_email LIKE ? ESCAPE '\\')`,
      );
      params.push(like(text), like(text), like(text.replace(/\s+/g, '')), like(text));
    }
    const inList = (column: string, values: readonly unknown[] | undefined): void => {
      if (values === undefined || values.length === 0) return;
      where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    };
    inList('s.program', query.programs);
    inList('s.branch', query.branches);
    inList('s.graduation_year', query.graduationYears);
    inList('s.status', query.statuses);
    if (query.tag !== undefined) {
      where.push(
        `EXISTS (SELECT 1 FROM student_tags st JOIN tags t ON t.id = st.tag_id
           WHERE st.student_id = s.id AND t.normalized = ?)`,
      );
      params.push(normalizeTag(query.tag));
    }
    if (query.mine === true) {
      where.push(
        `EXISTS (SELECT 1 FROM mentorships m WHERE m.student_id = s.id
           AND m.mentor_user_id = ? AND m.ended_at IS NULL)`,
      );
      params.push(actorId);
    }
    const filtered = where.join(' AND ');
    const keyset =
      after === undefined
        ? ''
        : 'WHERE (lower(m.full_name) > ? OR (lower(m.full_name) = ? AND m.id > ?))';
    const keysetParams = after === undefined ? [] : [after.name, after.name, after.id];
    return this.#db.raw
      .prepare(
        `WITH matched AS (
           SELECT s.*, d.name AS home_department_name, count(*) OVER () AS total
           FROM students s LEFT JOIN departments d ON d.id = s.home_department_id
           WHERE ${filtered}
         )
         SELECT m.id, m.university_id AS universityId, m.full_name AS fullName,
           m.preferred_name AS preferredName, m.institutional_email AS institutionalEmail,
           m.program, m.branch, m.graduation_year AS graduationYear, m.status,
           m.is_external AS isExternal, m.home_department_name AS homeDepartmentName,
           m.erased_at AS erasedAt, m.version, m.total
         FROM matched m ${keyset}
         ORDER BY lower(m.full_name), m.id LIMIT ?`,
      )
      .all(...params, ...keysetParams, query.limit + 1) as ListRow[];
  }

  /** The count when a page past the end has no rows to carry it. */
  countAll(organizationId: string): number {
    return (
      this.#db.raw
        .prepare(
          'SELECT count(*) AS n FROM students WHERE organization_id = ? AND erased_at IS NULL',
        )
        .get(organizationId) as { n: number }
    ).n;
  }

  /** Values the filter chips can offer. */
  facets(organizationId: string): { branches: string[]; graduationYears: number[] } {
    const branches = this.#db.raw
      .prepare(
        `SELECT DISTINCT branch AS v FROM students WHERE organization_id = ? AND erased_at IS NULL
           AND branch IS NOT NULL ORDER BY branch`,
      )
      .all(organizationId) as { v: string }[];
    const years = this.#db.raw
      .prepare(
        `SELECT DISTINCT graduation_year AS v FROM students WHERE organization_id = ?
           AND erased_at IS NULL AND graduation_year IS NOT NULL ORDER BY graduation_year`,
      )
      .all(organizationId) as { v: number }[];
    return { branches: branches.map((row) => row.v), graduationYears: years.map((row) => row.v) };
  }
}
