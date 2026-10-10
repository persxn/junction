import type {
  EraseStudentRequest,
  StudentDetail,
  StudentSettings,
  StudentVersionRequest,
} from '@compintel/contracts';

import { studentRef, universityIdKey } from '../../domain/students/records.js';
import { withAudit } from '../../platform/audit.js';
import { validationFailed } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import { studentErased, studentVersionConflict } from './errors.js';
import type { StudentsContext, StudentsDependencies } from './mappers.js';
import { StudentReader } from './reader.js';
import { STUDENTS_ALLOW_EXTERNAL, STUDENTS_PHONE_ENABLED } from './settings.js';

/**
 * A student's status, his erasure, and the two student settings.
 *
 * Deactivation is §10.2's mentor rule (`canDeactivateStudent`); erasure is an
 * administrator's alone and is R92 in full: one audited transaction that
 * anonymizes the row, deletes his tags, achievements and mentorships, and puts
 * nothing personal in the audit chain.
 */
export class StudentLifecycleService {
  readonly #deps: StudentsDependencies;
  readonly #clock: Clock;
  readonly #reader: StudentReader;

  constructor(deps: StudentsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new StudentReader(deps);
  }

  deactivate(context: StudentsContext, id: string, request: StudentVersionRequest): StudentDetail {
    return this.#setStatus(context, id, request.version, 'INACTIVE');
  }

  reactivate(context: StudentsContext, id: string, request: StudentVersionRequest): StudentDetail {
    return this.#setStatus(context, id, request.version, 'ACTIVE');
  }

  #setStatus(
    context: StudentsContext,
    id: string,
    version: number,
    status: 'ACTIVE' | 'INACTIVE',
  ): StudentDetail {
    const row = this.#reader.requireLive(id);
    assertCan(context.actor, 'student.deactivate', this.#reader.deactivateFacts(context.actor, id));
    if (row.version !== version) throw studentVersionConflict();
    if (row.status === status) return this.#reader.detail(context.actor, id);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: status === 'INACTIVE' ? 'student.deactivated' : 'student.reactivated',
        entityKind: 'student',
        entityId: id,
        summary: `${status === 'INACTIVE' ? 'Deactivated' : 'Reactivated'} ${studentRef(id)}`,
        diff: { status: { from: row.status, to: status } },
        requestId: context.requestId ?? null,
      },
      () => {
        if (!this.#deps.students.update(id, { status }, version, nowMs(this.#clock))) {
          throw studentVersionConflict();
        }
      },
    );
    return this.#reader.detail(context.actor, id);
  }

  /** R92. The roll number is typed again, so an erasure is never one click. */
  erase(context: StudentsContext, id: string, request: EraseStudentRequest): StudentDetail {
    assertCan(context.actor, 'student.erase');
    const row = this.#reader.require(id);
    if (row.erasedAt !== null) throw studentErased();
    // R135: a student-install teammate may have no roll number; the name confirms instead.
    const expected = row.universityIdKey ?? universityIdKey(row.fullName);
    if (universityIdKey(request.universityId) !== expected) {
      throw validationFailed([
        {
          path: 'body.universityId',
          message: 'That is not this student’s roll number, so nothing was erased.',
        },
      ]);
    }
    const at = nowMs(this.#clock);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.erased',
        entityKind: 'student',
        entityId: id,
        summary: `Erased ${studentRef(id)}`,
        diff: { erased: true },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.relations.eraseRelations(id);
        this.#deps.students.anonymize(id, at);
      },
    );
    return this.#reader.detail(context.actor, id);
  }

  settings(context: StudentsContext): StudentSettings {
    assertCan(context.actor, 'settings.manage');
    return this.#read();
  }

  updateSettings(context: StudentsContext, next: StudentSettings): StudentSettings {
    assertCan(context.actor, 'settings.manage');
    const before = this.#read();
    if (before.phoneEnabled === next.phoneEnabled && before.allowExternal === next.allowExternal) {
      return before;
    }
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'settings.students.changed',
        entityKind: 'settings',
        entityId: 'students',
        summary: 'Changed the student settings',
        diff: { before, after: next },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.settings.set(STUDENTS_PHONE_ENABLED, next.phoneEnabled, context.actor.id);
        this.#deps.settings.set(STUDENTS_ALLOW_EXTERNAL, next.allowExternal, context.actor.id);
      },
    );
    return this.#read();
  }

  #read(): StudentSettings {
    return {
      phoneEnabled: this.#deps.settings.get(STUDENTS_PHONE_ENABLED),
      allowExternal: this.#deps.settings.get(STUDENTS_ALLOW_EXTERNAL),
    };
  }
}
