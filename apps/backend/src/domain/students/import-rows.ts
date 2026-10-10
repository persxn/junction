import {
  PROGRAM_LABELS,
  STUDENT_IMPORT_FIELD_LABELS,
  type StudentImportColumn,
  type StudentImportField,
  type StudentImportFieldError,
  type StudentImportRow,
  type StudentProgram,
} from '@compintel/contracts';

import { normalizeTag } from '../../modules/categories/domain/text.js';
import { parseProgram, parseTagList, programChoices, universityIdKey } from './records.js';

/**
 * Validating every row of an import against a snapshot (ruling R93).
 *
 * Pure: the snapshot is the stored students and departments, read once by the
 * caller. Each problem is attached to the row and the field it is in, in words a
 * professor can act on — an unknown programme lists the ones that exist. The
 * same function runs twice: at preview, and again at commit against a fresh
 * snapshot, which is how a row that went stale in between is found.
 */

export interface ExistingStudent {
  readonly id: string;
  readonly universityId: string;
  readonly fullName: string;
  readonly preferredName: string | null;
  readonly institutionalEmail: string | null;
  readonly phone: string | null;
  readonly program: StudentProgram;
  readonly branch: string | null;
  readonly graduationYear: number | null;
  readonly homeDepartmentId: string;
  readonly notes: string | null;
  /** Normalized tag names the student already holds, per relation. */
  readonly skills: ReadonlySet<string>;
  readonly interests: ReadonlySet<string>;
  readonly version: number;
}

export interface DepartmentRef {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
}

export interface ImportSnapshot {
  /** By `universityIdKey`. */
  readonly students: ReadonlyMap<string, ExistingStudent>;
  readonly departments: readonly DepartmentRef[];
  /** Where a new student goes when the file names no department. */
  readonly managingDepartmentId: string;
}

/** What one row would write — what the commit applies. */
export interface RowPlan {
  readonly row: StudentImportRow;
  readonly existingId?: string | undefined;
  readonly existingVersion?: number | undefined;
  /** Typed values, only the mapped, non-empty ones (R93: an import never clears). */
  readonly fields: {
    readonly universityId?: string;
    readonly fullName?: string;
    readonly preferredName?: string;
    readonly institutionalEmail?: string;
    readonly phone?: string;
    readonly program?: StudentProgram;
    readonly branch?: string;
    readonly homeDepartmentId?: string;
    readonly graduationYear?: number;
    readonly notes?: string;
  };
  /** Tags to add (R93: an import only adds). */
  readonly skills: readonly { name: string; proficiency: 1 | 2 | 3 | null }[];
  readonly interests: readonly { name: string; proficiency: 1 | 2 | 3 | null }[];
}

type PlanFields = { -readonly [K in keyof RowPlan['fields']]: RowPlan['fields'][K] };

const LIMITS: Partial<Record<StudentImportField, number>> = {
  universityId: 40,
  fullName: 200,
  preferredName: 100,
  institutionalEmail: 254,
  phone: 30,
  branch: 100,
  notes: 500,
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

function departmentOf(cell: string, departments: readonly DepartmentRef[]): string | undefined {
  const key = squash(cell);
  return departments.find(
    (department) =>
      (department.code !== null && squash(department.code) === key) ||
      squash(department.name) === key,
  )?.id;
}

/** Plans every row; `rows` are the data rows (the header is not among them). */
export function planRows(
  rows: readonly (readonly string[])[],
  columns: readonly StudentImportColumn[],
  snapshot: ImportSnapshot,
  firstRowNumber = 2,
): RowPlan[] {
  const firstSeen = new Map<string, number>();
  const plans: RowPlan[] = [];
  rows.forEach((cells, index) => {
    // A blank row is no student; it keeps its place so later row numbers stay true.
    if (cells.every((cell) => cell.trim().length === 0)) return;
    plans.push(planRow(cells, firstRowNumber + index, columns, snapshot, firstSeen));
  });
  return plans;
}

function planRow(
  cells: readonly string[],
  rowNumber: number,
  columns: readonly StudentImportColumn[],
  snapshot: ImportSnapshot,
  firstSeen: Map<string, number>,
): RowPlan {
  {
    const values: Partial<Record<StudentImportField, string>> = {};
    for (const column of columns) {
      const cell = (cells[column.index] ?? '').trim();
      if (column.field !== null && cell.length > 0) values[column.field] = cell;
    }
    const errors: StudentImportFieldError[] = [];
    const fail = (field: StudentImportField | 'row', message: string): void => {
      errors.push({ field, message });
    };
    for (const [field, max] of Object.entries(LIMITS) as [StudentImportField, number][]) {
      const value = values[field];
      if (value !== undefined && value.length > max) {
        fail(
          field,
          `${STUDENT_IMPORT_FIELD_LABELS[field]} is longer than ${String(max)} characters.`,
        );
      }
    }

    const rawId = values.universityId;
    const key = rawId === undefined ? undefined : universityIdKey(rawId);
    if (key === undefined || key.length === 0) {
      fail('universityId', 'The roll number is empty; every student needs one.');
    } else if (firstSeen.has(key)) {
      fail(
        'universityId',
        `Roll number ${rawId ?? ''} already appears on row ${String(firstSeen.get(key))} of this file.`,
      );
    } else {
      firstSeen.set(key, rowNumber);
    }
    const existing = key === undefined ? undefined : snapshot.students.get(key);

    const fields: PlanFields = {};
    if (rawId !== undefined) fields.universityId = rawId;
    for (const field of ['fullName', 'preferredName', 'phone', 'branch', 'notes'] as const) {
      if (values[field] !== undefined) fields[field] = values[field];
    }
    if (values.institutionalEmail !== undefined) {
      if (EMAIL.test(values.institutionalEmail)) {
        fields.institutionalEmail = values.institutionalEmail.toLowerCase();
      } else {
        fail('institutionalEmail', `“${values.institutionalEmail}” is not an e-mail address.`);
      }
    }
    if (values.program !== undefined) {
      const program = parseProgram(values.program);
      if (program === undefined) {
        fail(
          'program',
          `“${values.program}” is not a programme Junction knows. Use one of: ${programChoices()}.`,
        );
      } else {
        fields.program = program;
      }
    }
    if (values.graduationYear !== undefined) {
      const year = Number(values.graduationYear);
      if (!/^\d{4}$/.test(values.graduationYear) || year < 1950 || year > 2100) {
        fail('graduationYear', `“${values.graduationYear}” is not a year such as 2027.`);
      } else {
        fields.graduationYear = year;
      }
    }
    if (values.homeDepartment !== undefined) {
      const id = departmentOf(values.homeDepartment, snapshot.departments);
      if (id === undefined) {
        const known = snapshot.departments
          .map((d) => (d.code === null ? d.name : `${d.name} (${d.code})`))
          .join(', ');
        fail(
          'homeDepartment',
          `“${values.homeDepartment}” is not a department here. Use one of: ${known}.`,
        );
      } else {
        fields.homeDepartmentId = id;
      }
    }
    const tagLists = { skills: [] as RowPlan['skills'], interests: [] as RowPlan['interests'] };
    for (const field of ['skills', 'interests'] as const) {
      const cell = values[field];
      if (cell === undefined) continue;
      const parsed = parseTagList(cell);
      if (parsed.ok) tagLists[field] = parsed.tags;
      else fail(field, parsed.message);
    }

    if (existing === undefined) {
      if (values.fullName === undefined) fail('fullName', 'A new student needs a full name.');
      if (values.program === undefined) {
        fail('program', `A new student needs a programme: ${programChoices()}.`);
      }
      fields.homeDepartmentId ??= snapshot.managingDepartmentId;
    }

    const changes =
      existing === undefined
        ? []
        : describeChanges(existing, fields, tagLists, snapshot.departments);
    const addSkills =
      existing === undefined
        ? tagLists.skills
        : tagLists.skills.filter((tag) => !existing.skills.has(normalizeTag(tag.name)));
    const addInterests =
      existing === undefined
        ? tagLists.interests
        : tagLists.interests.filter((tag) => !existing.interests.has(normalizeTag(tag.name)));
    const action = existing === undefined ? 'CREATE' : changes.length > 0 ? 'UPDATE' : 'SKIP';
    return {
      row: { rowNumber, action, values, changes, errors },
      existingId: existing?.id,
      existingVersion: existing?.version,
      fields,
      skills: addSkills,
      interests: addInterests,
    };
  }
}

/** What an UPDATE would change, in words; only fields the file states and that differ. */
function describeChanges(
  existing: ExistingStudent,
  fields: PlanFields,
  tags: { skills: RowPlan['skills']; interests: RowPlan['interests'] },
  departments: readonly DepartmentRef[],
): StudentImportRow['changes'] {
  const departmentName = (id: string): string =>
    departments.find((department) => department.id === id)?.name ?? 'an unknown department';
  const out: StudentImportRow['changes'] = [];
  const compare = (
    field: StudentImportField,
    before: string | null,
    after: string | number | undefined,
  ): void => {
    if (after === undefined) return;
    const next = String(after);
    if ((before ?? '') !== next) out.push({ field, from: before ?? '', to: next });
  };
  compare('fullName', existing.fullName, fields.fullName);
  compare('preferredName', existing.preferredName, fields.preferredName);
  compare('institutionalEmail', existing.institutionalEmail, fields.institutionalEmail);
  compare('phone', existing.phone, fields.phone);
  if (fields.program !== undefined && fields.program !== existing.program) {
    out.push({
      field: 'program',
      from: PROGRAM_LABELS[existing.program],
      to: PROGRAM_LABELS[fields.program],
    });
  }
  compare('branch', existing.branch, fields.branch);
  compare(
    'graduationYear',
    existing.graduationYear === null ? null : String(existing.graduationYear),
    fields.graduationYear,
  );
  if (
    fields.homeDepartmentId !== undefined &&
    fields.homeDepartmentId !== existing.homeDepartmentId
  ) {
    out.push({
      field: 'homeDepartment',
      from: departmentName(existing.homeDepartmentId),
      to: departmentName(fields.homeDepartmentId),
    });
  }
  compare('notes', existing.notes, fields.notes);
  for (const [field, held] of [
    ['skills', existing.skills],
    ['interests', existing.interests],
  ] as const) {
    const added = tags[field].filter((tag) => !held.has(normalizeTag(tag.name)));
    if (added.length > 0) {
      out.push({ field, from: '', to: added.map((tag) => tag.name).join(', ') });
    }
  }
  return out;
}

/** The preview's four counts; a row with any error counts only as an error. */
export function countRows(plans: readonly RowPlan[]): {
  create: number;
  update: number;
  skip: number;
  error: number;
  total: number;
} {
  const counts = { create: 0, update: 0, skip: 0, error: 0, total: plans.length };
  for (const { row } of plans) {
    if (row.errors.length > 0) counts.error += 1;
    else if (row.action === 'CREATE') counts.create += 1;
    else if (row.action === 'UPDATE') counts.update += 1;
    else counts.skip += 1;
  }
  return counts;
}
