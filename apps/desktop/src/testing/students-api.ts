import {
  problemType,
  type StudentDetail,
  type StudentImportPreview,
  type StudentListItem,
  type StudentSettings,
} from '@compintel/contracts';
import { vi } from 'vitest';

import { TEST_USER } from './auth.js';

/**
 * The students backend, as far as the WP-17 screens can tell — in memory, with
 * synthetic people only (D-33). Every answer is shaped like the real one so the
 * client's contract parse runs on it; every call is recorded.
 */

export const CSE = '0192f0c1-0000-7000-8000-00000000d001';
export const OTHER_PROFESSOR = '0192f0c1-0000-7000-8000-00000000a002';
const AT = '2026-09-27T10:00:00.000Z';

const id = (n: number): string => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export function makeStudent(n: number, patch: Partial<StudentDetail> = {}): StudentDetail {
  return {
    id: id(0x5000 + n),
    universityId: `DEMO${String(n).padStart(4, '0')}`,
    fullName: `Demo Student ${String(n)}`,
    preferredName: null,
    institutionalEmail: `demo${String(n)}@example.edu`,
    homeDepartmentId: CSE,
    homeDepartmentName: 'Computer Science',
    program: 'BTECH',
    branch: 'Computer Science and Engineering',
    graduationYear: 2027,
    isExternal: false,
    externalInstitution: null,
    status: 'ACTIVE',
    notes: null,
    privacyNoticeAckAt: AT,
    createdAt: AT,
    erasedAt: null,
    tags: [],
    mentors: [],
    achievements: [],
    teams: [],
    competitions: [],
    canDeactivate: true,
    canErase: false,
    version: 1,
    ...patch,
  };
}

let mentorships = 0;

export function mentoredBy(userId: string, displayName: string) {
  mentorships += 1;
  return {
    mentorshipId: id(0x7000 + mentorships),
    userId,
    displayName,
    startedAt: AT,
    endedAt: null,
    note: null,
  };
}

export const IMPORT_PREVIEW: StudentImportPreview = {
  previewId: 'preview-0123456789abcdef',
  fileName: 'cse-2027.csv',
  format: 'CSV',
  columns: [
    { index: 0, header: 'Roll No', field: 'universityId', guessed: true },
    { index: 1, header: 'Name', field: 'fullName', guessed: true },
    { index: 2, header: 'Programme', field: 'program', guessed: true },
    { index: 3, header: 'Hostel', field: null, guessed: false },
  ],
  unknownColumns: ['Hostel'],
  mappingErrors: [],
  counts: { create: 2, update: 0, skip: 0, error: 1, total: 3 },
  rows: [
    {
      rowNumber: 2,
      action: 'CREATE',
      values: { universityId: 'NEW0001', fullName: 'New One', program: 'B.Tech' },
      changes: [],
      errors: [],
    },
    {
      rowNumber: 3,
      action: 'CREATE',
      values: { universityId: 'NEW0002', fullName: 'New Two', program: 'BCA' },
      changes: [],
      errors: [],
    },
    {
      rowNumber: 4,
      action: 'CREATE',
      values: { universityId: 'NEW0003', fullName: 'New Three', program: 'Diploma' },
      changes: [],
      errors: [
        { field: 'program', message: '“Diploma” is not a programme. Use one of: B.Tech, M.Tech.' },
      ],
    },
  ],
  expiresAt: '2099-01-01T00:00:00.000Z',
};

export interface StudentsApiOptions {
  readonly students?: StudentDetail[];
  /** The next tag write answers 409 (someone else changed the student). */
  readonly conflictOnTags?: boolean;
  /** The next tag write answers 500. */
  readonly failTags?: boolean;
  /** The commit answers 410, as after 30 minutes. */
  readonly previewExpired?: boolean;
  readonly settings?: StudentSettings;
}

export interface StudentsCall {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly body: Record<string, unknown> | undefined;
}

export interface StudentsApi {
  readonly calls: StudentsCall[];
  readonly students: Map<string, StudentDetail>;
  readonly settings: { value: StudentSettings };
}

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const problem = (status: number, code: string, detail: string): Response =>
  respond(status, {
    type: problemType(code as never),
    title: detail,
    status,
    code,
    detail,
    requestId: 'r',
  });

function listItem(student: StudentDetail): StudentListItem {
  const open = student.mentors.filter((mentor) => mentor.endedAt === null);
  return {
    id: student.id,
    universityId: student.universityId,
    fullName: student.fullName,
    preferredName: student.preferredName,
    institutionalEmail: student.institutionalEmail,
    program: student.program,
    branch: student.branch,
    graduationYear: student.graduationYear,
    status: student.status,
    isExternal: student.isExternal,
    homeDepartmentName: student.homeDepartmentName,
    tags: student.tags.map((tag) => ({ name: tag.name, relation: tag.relation })),
    mentorNames: open.map((mentor) => mentor.displayName),
    isMine: open.some((mentor) => mentor.userId === TEST_USER.id),
    teamCount: student.teams.filter((team) => team.leftAt === null).length,
    erased: student.erasedAt !== null,
    version: student.version,
  };
}

export function installStudentsApi(options: StudentsApiOptions = {}): StudentsApi {
  const calls: StudentsCall[] = [];
  const students = new Map((options.students ?? []).map((student) => [student.id, student]));
  const settings = { value: options.settings ?? { phoneEnabled: false, allowExternal: false } };
  let conflict = options.conflictOnTags === true;
  let failTags = options.failTags === true;
  let created = 0;

  const save = (student: StudentDetail): Response => {
    students.set(student.id, student);
    return respond(200, student);
  };

  const route = (
    method: string,
    path: string,
    params: URLSearchParams,
    body: Record<string, unknown> | undefined,
  ): Response => {
    if (path === '/api/v1/students' && method === 'GET') {
      const text = (params.get('text') ?? '').toLowerCase();
      const statuses = params.get('statuses')?.split(',');
      const all = [...students.values()]
        .filter(
          (student) =>
            text === '' ||
            `${student.fullName} ${student.universityId}`.toLowerCase().includes(text),
        )
        .filter((student) => statuses === undefined || statuses.includes(student.status))
        .filter((student) => params.get('mine') !== 'true' || listItem(student).isMine)
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      const offset = Number(params.get('cursor') ?? '0');
      const limit = Number(params.get('limit') ?? '50');
      const next = offset + limit;
      return respond(200, {
        items: all.slice(offset, next).map(listItem),
        nextCursor: next < all.length ? String(next) : null,
        total: all.length,
        facets: { branches: ['Computer Science and Engineering'], graduationYears: [2026, 2027] },
      });
    }
    // WP-21: a student's history, built from the competitions the page already lists.
    const history = /^\/api\/v1\/students\/([^/]+)\/history$/.exec(path);
    if (history !== null) {
      const student = students.get(history[1] ?? '');
      return respond(200, {
        studentId: history[1],
        erased: student?.erasedAt !== null && student?.erasedAt !== undefined,
        competitions: (student?.competitions ?? []).map((ref) => ({
          competitionId: ref.id,
          eventTitle: ref.eventTitle,
          startsAt: null,
          endsAt: null,
          datePrecision: 'UNKNOWN',
          teamName: ref.teamName,
          status: ref.status,
          outcomeState: 'NONE',
          outcome: null,
          addedAt: '2026-10-01T06:00:00.000Z',
          removedAt: ref.onRoster ? null : '2026-10-05T06:00:00.000Z',
        })),
        teams: [],
        achievements: [],
      });
    }
    if (path === '/api/v1/students/options') {
      return respond(200, {
        settings: settings.value,
        departments: [{ id: CSE, name: 'Computer Science', code: 'CSE', isManaging: true }],
      });
    }
    if (path === '/api/v1/admin/settings/students') {
      if (method === 'PUT') settings.value = body as unknown as StudentSettings;
      return respond(200, settings.value);
    }
    if (path === '/api/v1/tags')
      return respond(200, { tags: [{ id: id(0x9001), name: 'Python' }] });
    if (path === '/api/v1/students' && method === 'POST') {
      created += 1;
      const student = makeStudent(900 + created, {
        universityId: String(body?.universityId),
        fullName: String(body?.fullName),
        mentors: body?.mentorMe === false ? [] : [mentoredBy(TEST_USER.id, TEST_USER.displayName)],
      });
      return save(student);
    }
    if (path === '/api/v1/students/import/preview') return respond(200, IMPORT_PREVIEW);
    if (path === '/api/v1/students/import/commit') {
      if (options.previewExpired === true)
        return problem(410, 'STUDENT_IMPORT_PREVIEW_EXPIRED', 'The preview expired.');
      return respond(200, { created: 2, updated: 0, skipped: 0, failed: 1, stale: [] });
    }
    const erase = /^\/api\/v1\/admin\/students\/([^/]+)\/erase$/.exec(path);
    if (erase !== null) {
      const student = students.get(erase[1] ?? '');
      if (student === undefined) return problem(404, 'STUDENT_NOT_FOUND', 'No such student.');
      return save({
        ...student,
        fullName: 'Erased student',
        erasedAt: AT,
        tags: [],
        mentors: [],
        achievements: [],
        version: student.version + 1,
      });
    }
    const one =
      /^\/api\/v1\/students\/([^/]+)(?:\/(tags|deactivate|reactivate|mentorships))?$/.exec(path);
    if (one !== null) {
      const student = students.get(one[1] ?? '');
      if (student === undefined) return problem(404, 'STUDENT_NOT_FOUND', 'No such student.');
      const version = student.version + 1;
      switch (one[2]) {
        case 'tags': {
          if (failTags) {
            failTags = false;
            return problem(500, 'INTERNAL', 'The server failed while saving.');
          }
          if (conflict) {
            conflict = false;
            return problem(409, 'STUDENT_VERSION_CONFLICT', 'Someone else changed this student.');
          }
          const tags = (body?.tags ?? []) as {
            name: string;
            relation: 'SKILL' | 'INTEREST';
            proficiency: 1 | 2 | 3 | null;
          }[];
          return save({
            ...student,
            tags: tags.map((tag, index) => ({ tagId: id(0x8000 + index), ...tag })),
            version,
          });
        }
        case 'deactivate':
          return save({ ...student, status: 'INACTIVE', version });
        case 'reactivate':
          return save({ ...student, status: 'ACTIVE', version });
        case 'mentorships':
          return save({
            ...student,
            mentors: [...student.mentors, mentoredBy(TEST_USER.id, TEST_USER.displayName)],
            version,
          });
        default:
          if (method === 'PATCH')
            return save({ ...student, ...(body as Partial<StudentDetail>), version });
          return respond(200, student);
      }
    }
    return problem(404, 'NOT_FOUND', 'Not found');
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      calls.push({ method, path: parsed.pathname, query: parsed.search, body });
      return Promise.resolve(route(method, parsed.pathname, parsed.searchParams, body));
    }),
  );
  return { calls, students, settings };
}
