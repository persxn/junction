import { canDeactivateStudent, type StudentDetail } from '@compintel/contracts';

import type { StudentRow } from '../../db/schema/index.js';
import { can } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { studentErased, studentNotFound } from './errors.js';
import { toDetail, type StudentsDependencies } from './mappers.js';
import { STUDENTS_PHONE_ENABLED } from './settings.js';

/**
 * Loading a student and the facts the permission matrix needs about them. Every
 * students service goes through this, so "not found", "erased" and "may this
 * user deactivate him" are decided one way.
 */
export class StudentReader {
  readonly #deps: StudentsDependencies;

  constructor(deps: StudentsDependencies) {
    this.#deps = deps;
  }

  /** The organization every student here belongs to (Q1: one per installation). */
  organizationId(): string {
    const id = this.#deps.students.organizationId();
    if (id === undefined) throw new Error('setup has not created an organization yet');
    return id;
  }

  /** The row, or 404 — also for a student of another organization. */
  require(id: string): StudentRow {
    const row = this.#deps.students.findById(id);
    if (row?.organizationId !== this.organizationId()) throw studentNotFound();
    return row;
  }

  /** The row, refusing an erased one (R92: it can no longer be edited). */
  requireLive(id: string): StudentRow {
    const row = this.require(id);
    if (row.erasedAt !== null) throw studentErased();
    return row;
  }

  /** §10.2's deactivate facts: a direct mentor, or a mentor of an active team the student is in. */
  deactivateFacts(actor: Principal, studentId: string): { isStudentMentor: boolean } {
    return {
      isStudentMentor: canDeactivateStudent(actor, {
        mentorUserIds: this.#deps.relations.openMentorUserIds(studentId),
        teamMentorUserIds: this.#deps.teamLinks.teamMentorUserIds(studentId),
      }),
    };
  }

  detail(actor: Principal, id: string): StudentDetail {
    const row = this.require(id);
    const departmentName =
      this.#deps.students
        .departments(row.organizationId)
        .find((department) => department.id === row.homeDepartmentId)?.name ?? null;
    return toDetail({
      row,
      departmentName,
      tags: this.#deps.relations.tagsByStudent([id])[0]?.[1] ?? [],
      mentors: this.#deps.relations.mentorshipsOf([id]),
      achievements: this.#deps.relations.achievementsOf(id),
      teams: this.#deps.teamLinks.teamsOf(id),
      phoneEnabled: this.#deps.settings.get(STUDENTS_PHONE_ENABLED),
      canDeactivate:
        row.erasedAt === null && can(actor, 'student.deactivate', this.deactivateFacts(actor, id)),
      canErase: row.erasedAt === null && can(actor, 'student.erase'),
    });
  }
}
