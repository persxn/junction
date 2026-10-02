import type {
  StudentCreateRequest,
  StudentDetail,
  StudentFormOptions,
  StudentListQuery,
  StudentListResponse,
  StudentUpdateRequest,
} from '@compintel/contracts';

import { auditDiff, studentRef, universityIdKey } from '../../domain/students/records.js';
import { withAudit } from '../../platform/audit.js';
import { validationFailed } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import {
  externalDisabled,
  phoneDisabled,
  studentVersionConflict,
  universityIdTaken,
} from './errors.js';
import {
  decodeCursor,
  encodeCursor,
  toListItem,
  type StudentsContext,
  type StudentsDependencies,
} from './mappers.js';
import { StudentReader } from './reader.js';
import type { StudentPatch } from './repository.js';
import { STUDENTS_ALLOW_EXTERNAL, STUDENTS_PHONE_ENABLED } from './settings.js';

/**
 * Student records: the list, the page, create and edit (§10.2, R91, R92).
 *
 * Every professor sees and edits every student (R91). Every write is one
 * `withAudit` unit, and **no audit summary or diff carries a name, an e-mail, a
 * phone number or notes** (R92) — a summary names "student 01a0…", a changed
 * personal field is recorded as `"<changed>"`.
 */

const blankToNull = (value: string | null | undefined): string | null | undefined =>
  value === undefined ? undefined : value === null || value.trim() === '' ? null : value.trim();

/** SQLite's unique-index failure, which a race between two creates can still reach. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export class StudentsService {
  readonly #deps: StudentsDependencies;
  readonly #clock: Clock;
  readonly #reader: StudentReader;

  constructor(deps: StudentsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new StudentReader(deps);
  }

  formOptions(context: StudentsContext): StudentFormOptions {
    assertCan(context.actor, 'student.view');
    return {
      settings: {
        phoneEnabled: this.#deps.settings.get(STUDENTS_PHONE_ENABLED),
        allowExternal: this.#deps.settings.get(STUDENTS_ALLOW_EXTERNAL),
      },
      departments: this.#deps.students.departments(this.#reader.organizationId()),
    };
  }

  list(context: StudentsContext, query: StudentListQuery): StudentListResponse {
    assertCan(context.actor, 'student.view');
    const organizationId = this.#reader.organizationId();
    const rows = this.#deps.students.list(
      organizationId,
      query,
      context.actor.id,
      decodeCursor(query.cursor),
    );
    const page = rows.slice(0, query.limit);
    const ids = page.map((row) => row.id);
    const tags = new Map(this.#deps.relations.tagsByStudent(ids));
    const mentors = this.#deps.relations.mentorshipsOf(ids);
    const last = page.at(-1);
    return {
      items: page.map((row) =>
        toListItem(
          row,
          tags.get(row.id) ?? [],
          mentors.filter((mentor) => mentor.studentId === row.id),
          context.actor.id,
        ),
      ),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ name: last.fullName.toLowerCase(), id: last.id })
          : null,
      total:
        page[0]?.total ??
        (query.cursor === undefined ? 0 : this.#deps.students.countAll(organizationId)),
      facets: this.#deps.students.facets(organizationId),
    };
  }

  get(context: StudentsContext, id: string): StudentDetail {
    assertCan(context.actor, 'student.view');
    return this.#reader.detail(context.actor, id);
  }

  create(context: StudentsContext, request: StudentCreateRequest): StudentDetail {
    assertCan(context.actor, 'student.create');
    const organizationId = this.#reader.organizationId();
    this.#gate(blankToNull(request.phone), request.isExternal === true);
    const key = universityIdKey(request.universityId);
    if (this.#deps.students.findByKey(organizationId, key) !== undefined) {
      throw universityIdTaken(request.universityId);
    }
    const departmentId = this.#department(organizationId, request.homeDepartmentId);
    const id = uuid7();
    const at = nowMs(this.#clock);
    try {
      withAudit(
        this.#deps.audit,
        {
          actorKind: 'USER',
          actorUserId: context.actor.id,
          action: 'student.created',
          entityKind: 'student',
          entityId: id,
          summary: `Created ${studentRef(id)}`,
          diff: { program: request.program, mentoredByCreator: request.mentorMe },
          requestId: context.requestId ?? null,
        },
        () => {
          this.#deps.students.insert({
            id,
            organizationId,
            universityId: request.universityId.trim(),
            universityIdKey: key,
            fullName: request.fullName.trim(),
            preferredName: blankToNull(request.preferredName) ?? null,
            institutionalEmail: blankToNull(request.institutionalEmail)?.toLowerCase() ?? null,
            phone: blankToNull(request.phone) ?? null,
            homeDepartmentId: departmentId,
            program: request.program,
            branch: blankToNull(request.branch) ?? null,
            graduationYear: request.graduationYear ?? null,
            isExternal: request.isExternal === true,
            externalInstitution:
              request.isExternal === true
                ? (blankToNull(request.externalInstitution) ?? null)
                : null,
            status: 'ACTIVE',
            notes: blankToNull(request.notes) ?? null,
            privacyNoticeAckAt: request.privacyNoticeShown === true ? at : null,
            createdAt: at,
            createdBy: context.actor.id,
            updatedAt: at,
          });
          if (request.mentorMe) {
            this.#deps.relations.startMentorship({
              mentorUserId: context.actor.id,
              studentId: id,
              note: null,
              createdBy: context.actor.id,
              at,
            });
          }
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw universityIdTaken(request.universityId);
      throw error;
    }
    return this.#reader.detail(context.actor, id);
  }

  update(context: StudentsContext, id: string, request: StudentUpdateRequest): StudentDetail {
    assertCan(context.actor, 'student.edit');
    const row = this.#reader.requireLive(id);
    if (row.version !== request.version) throw studentVersionConflict();
    const phone = blankToNull(request.phone);
    this.#gate(phone, request.isExternal === true && !row.isExternal);

    const patch: StudentPatch = {};
    const changed: Record<string, unknown> = {};
    const set = <K extends keyof StudentPatch>(
      field: K,
      value: StudentPatch[K] | undefined,
    ): void => {
      if (value === undefined || value === row[field]) return;
      (patch as Record<string, unknown>)[field] = value;
      changed[field] = value;
    };
    if (request.universityId !== undefined) {
      const key = universityIdKey(request.universityId);
      if (key !== row.universityIdKey) {
        const holder = this.#deps.students.findByKey(row.organizationId, key);
        if (holder !== undefined && holder.id !== id) throw universityIdTaken(request.universityId);
        set('universityId', request.universityId.trim());
        patch.universityIdKey = key;
      }
    }
    set('fullName', request.fullName?.trim());
    set('preferredName', blankToNull(request.preferredName));
    const email = blankToNull(request.institutionalEmail);
    set('institutionalEmail', email === null || email === undefined ? email : email.toLowerCase());
    set('phone', phone);
    if (request.homeDepartmentId !== undefined) {
      set('homeDepartmentId', this.#department(row.organizationId, request.homeDepartmentId));
    }
    set('program', request.program);
    set('branch', blankToNull(request.branch));
    set('graduationYear', request.graduationYear);
    set('isExternal', request.isExternal);
    set('externalInstitution', blankToNull(request.externalInstitution));
    set('notes', blankToNull(request.notes));
    if (request.privacyNoticeShown === true && row.privacyNoticeAckAt === null) {
      set('privacyNoticeAckAt', nowMs(this.#clock));
    }
    if (Object.keys(patch).length === 0) return this.#reader.detail(context.actor, id);

    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.updated',
        entityKind: 'student',
        entityId: id,
        summary: `Edited ${studentRef(id)}`,
        diff: auditDiff(changed),
        requestId: context.requestId ?? null,
      },
      () => {
        if (!this.#deps.students.update(id, patch, request.version, nowMs(this.#clock))) {
          throw studentVersionConflict();
        }
      },
    );
    return this.#reader.detail(context.actor, id);
  }

  /** Q6/Q8: the two settings decide what a form may carry. */
  #gate(phone: string | null | undefined, becomingExternal: boolean): void {
    if (phone !== undefined && phone !== null && !this.#deps.settings.get(STUDENTS_PHONE_ENABLED)) {
      throw phoneDisabled();
    }
    if (becomingExternal && !this.#deps.settings.get(STUDENTS_ALLOW_EXTERNAL)) {
      throw externalDisabled();
    }
  }

  /** The department asked for, or the managing one; another organization's is refused. */
  #department(organizationId: string, requested: string | undefined): string {
    const departments = this.#deps.students.departments(organizationId);
    if (requested === undefined) {
      const managing = departments.find((department) => department.isManaging) ?? departments[0];
      if (managing === undefined) throw new Error('the organization has no department');
      return managing.id;
    }
    if (!departments.some((department) => department.id === requested)) {
      throw validationFailed([
        {
          path: 'body.homeDepartmentId',
          message: 'That department is not one of this institution’s.',
        },
      ]);
    }
    return requested;
  }
}
