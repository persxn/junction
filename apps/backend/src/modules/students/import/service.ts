import type {
  StudentImportCommitRequest,
  StudentImportCommitResult,
  StudentImportPreview,
  StudentImportPreviewRequest,
  StudentImportRow,
} from '@compintel/contracts';

import { mapColumns } from '../../../domain/students/import-mapping.js';
import {
  countRows,
  planRows,
  type ExistingStudent,
  type ImportSnapshot,
  type RowPlan,
} from '../../../domain/students/import-rows.js';
import { auditDiff, studentRef, universityIdKey } from '../../../domain/students/records.js';
import { recordAudit } from '../../../platform/audit.js';
import { validationFailed } from '../../../platform/errors.js';
import { uuid7 } from '../../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../../platform/time.js';
import { normalizeTag } from '../../categories/domain/text.js';
import { assertCan } from '../../auth/policy.js';
import type { StudentsContext, StudentsDependencies } from '../mappers.js';
import { STUDENTS_PHONE_ENABLED } from '../settings.js';
import { parseImportFile } from './parse.js';
import { PreviewStore } from './preview-store.js';

/**
 * Importing students (ruling R93, roadmap WP-17 step 4).
 *
 * `preview` reads the file, maps it and validates every row against the stored
 * students — and writes nothing. `commit` takes the preview's id, looks again at
 * the database **now**, and applies only rows that had no errors and still mean
 * what the preview said, in one transaction: one summary audit row with the
 * counts plus one per student created or updated (R92: none names anybody).
 */

export interface ImportServiceDependencies extends StudentsDependencies {
  readonly previews?: PreviewStore;
}

/** Two looks at one row agree when they would do the same thing. */
function sameMeaning(before: StudentImportRow, after: StudentImportRow): boolean {
  return (
    before.action === after.action &&
    JSON.stringify(before.changes) === JSON.stringify(after.changes)
  );
}

export class StudentImportService {
  readonly #deps: ImportServiceDependencies;
  readonly #clock: Clock;
  readonly #previews: PreviewStore;

  constructor(deps: ImportServiceDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#previews = deps.previews ?? new PreviewStore(this.#clock);
  }

  preview(context: StudentsContext, request: StudentImportPreviewRequest): StudentImportPreview {
    assertCan(context.actor, 'student.import');
    const file = parseImportFile(request.fileName, request.base64);
    const mapping = mapColumns(file.headers, {
      phoneEnabled: this.#deps.settings.get(STUDENTS_PHONE_ENABLED),
      override: request.mapping,
    });
    const mappingOk = mapping.errors.length === 0;
    const plans = mappingOk
      ? planRows(file.rows, mapping.columns, this.#snapshot(), file.firstRowNumber)
      : [];
    const createdAt = nowMs(this.#clock);
    const stored = {
      userId: context.actor.id,
      createdAt,
      fileName: request.fileName,
      rows: file.rows,
      firstRowNumber: file.firstRowNumber,
      columns: mapping.columns,
      mappingOk,
      plans,
    };
    const previewId = this.#previews.put(stored);
    return {
      previewId,
      fileName: request.fileName,
      format: file.format,
      columns: [...mapping.columns],
      unknownColumns: [...mapping.unknownColumns],
      mappingErrors: [...mapping.errors],
      counts: countRows(plans),
      rows: plans.map((plan) => plan.row),
      expiresAt: new Date(this.#previews.expiresAt(stored)).toISOString(),
    };
  }

  commit(context: StudentsContext, request: StudentImportCommitRequest): StudentImportCommitResult {
    assertCan(context.actor, 'student.import');
    const stored = this.#previews.get(context.actor.id, request.previewId);
    if (!stored.mappingOk) {
      throw validationFailed([
        { path: 'body.previewId', message: 'Fix the column mapping and preview again first.' },
      ]);
    }
    const fresh = planRows(stored.rows, stored.columns, this.#snapshot(), stored.firstRowNumber);
    const freshByRow = new Map(fresh.map((plan) => [plan.row.rowNumber, plan]));
    const result = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      stale: [] as { rowNumber: number; reason: string }[],
    };
    const apply: RowPlan[] = [];
    for (const before of stored.plans) {
      const now = freshByRow.get(before.row.rowNumber);
      if (before.row.errors.length > 0) {
        result.failed += 1;
      } else if (now === undefined || now.row.errors.length > 0) {
        result.stale.push({
          rowNumber: before.row.rowNumber,
          reason: `No longer passes the checks: ${now?.row.errors[0]?.message ?? 'the row changed'}`,
        });
      } else if (!sameMeaning(before.row, now.row)) {
        result.stale.push({
          rowNumber: before.row.rowNumber,
          reason:
            before.row.action === 'CREATE'
              ? 'A student with this roll number was added after the preview.'
              : 'This student was changed after the preview; preview the file again.',
        });
      } else if (now.row.action === 'SKIP') {
        result.skipped += 1;
      } else {
        apply.push(now);
      }
    }

    const at = nowMs(this.#clock);
    const organizationId = this.#organizationId();
    this.#deps.audit.transaction(() => {
      for (const plan of apply) {
        if (plan.row.action === 'CREATE') {
          this.#create(context, organizationId, plan, request, at);
          result.created += 1;
        } else {
          this.#update(context, plan, at);
          result.updated += 1;
        }
      }
      recordAudit(this.#deps.audit, {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.import.committed',
        entityKind: 'student_import',
        entityId: request.previewId.slice(0, 16),
        summary: `Imported students: ${String(result.created)} created, ${String(result.updated)} updated`,
        diff: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          stale: result.stale.length,
          mentoredByImporter: request.mentorMe,
        },
        requestId: context.requestId ?? null,
      });
    });
    this.#previews.delete(request.previewId);
    return result;
  }

  #create(
    context: StudentsContext,
    organizationId: string,
    plan: RowPlan,
    request: StudentImportCommitRequest,
    at: number,
  ): void {
    const { fields } = plan;
    const id = uuid7();
    const universityId = fields.universityId ?? '';
    this.#deps.students.insert({
      id,
      organizationId,
      universityId,
      universityIdKey: universityIdKey(universityId),
      fullName: fields.fullName ?? '',
      preferredName: fields.preferredName ?? null,
      institutionalEmail: fields.institutionalEmail ?? null,
      phone: fields.phone ?? null,
      homeDepartmentId: fields.homeDepartmentId ?? '',
      program: fields.program ?? 'OTHER',
      branch: fields.branch ?? null,
      graduationYear: fields.graduationYear ?? null,
      isExternal: false,
      externalInstitution: null,
      status: 'ACTIVE',
      notes: fields.notes ?? null,
      privacyNoticeAckAt: request.privacyNoticeShown ? at : null,
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
    this.#addTags(id, plan, at);
    recordAudit(this.#deps.audit, {
      actorKind: 'USER',
      actorUserId: context.actor.id,
      action: 'student.created',
      entityKind: 'student',
      entityId: id,
      summary: `Imported ${studentRef(id)}`,
      diff: { program: fields.program ?? null, via: 'import', row: plan.row.rowNumber },
      requestId: context.requestId ?? null,
    });
  }

  #update(context: StudentsContext, plan: RowPlan, at: number): void {
    const id = plan.existingId ?? '';
    const changed = Object.fromEntries(
      plan.row.changes
        .filter((change) => change.field !== 'skills' && change.field !== 'interests')
        .map((change) => [change.field, change.to]),
    );
    const { fields } = plan;
    const patch = {
      ...(changed.fullName === undefined ? {} : { fullName: fields.fullName }),
      ...(changed.preferredName === undefined ? {} : { preferredName: fields.preferredName }),
      ...(changed.institutionalEmail === undefined
        ? {}
        : { institutionalEmail: fields.institutionalEmail }),
      ...(changed.phone === undefined ? {} : { phone: fields.phone }),
      ...(changed.program === undefined ? {} : { program: fields.program }),
      ...(changed.branch === undefined ? {} : { branch: fields.branch }),
      ...(changed.graduationYear === undefined ? {} : { graduationYear: fields.graduationYear }),
      ...(changed.homeDepartment === undefined
        ? {}
        : { homeDepartmentId: fields.homeDepartmentId }),
      ...(changed.notes === undefined ? {} : { notes: fields.notes }),
    };
    if (!this.#deps.students.update(id, patch, plan.existingVersion ?? 0, at)) {
      throw new Error('a student changed during the import transaction');
    }
    this.#addTags(id, plan, at);
    recordAudit(this.#deps.audit, {
      actorKind: 'USER',
      actorUserId: context.actor.id,
      action: 'student.updated',
      entityKind: 'student',
      entityId: id,
      summary: `Updated ${studentRef(id)} from an import`,
      diff: {
        ...auditDiff(changed),
        ...(plan.skills.length + plan.interests.length > 0
          ? { tagsAdded: plan.skills.length + plan.interests.length }
          : {}),
        via: 'import',
        row: plan.row.rowNumber,
      },
      requestId: context.requestId ?? null,
    });
  }

  /** R93: an import only adds tags; a tag the student holds keeps its level. */
  #addTags(studentId: string, plan: RowPlan, at: number): void {
    for (const [relation, tags] of [
      ['SKILL', plan.skills],
      ['INTEREST', plan.interests],
    ] as const) {
      for (const tag of tags) {
        const tagId = this.#deps.relations.ensureTag(relation, tag.name, at);
        this.#deps.relations.addTag(studentId, tagId, relation, tag.proficiency);
      }
    }
  }

  #organizationId(): string {
    const id = this.#deps.students.organizationId();
    if (id === undefined) throw new Error('setup has not created an organization yet');
    return id;
  }

  /** Every live student, with the tags each already holds, and the departments. */
  #snapshot(): ImportSnapshot {
    const organizationId = this.#organizationId();
    const rows = this.#deps.students.allLive(organizationId);
    const tags = new Map(this.#deps.relations.tagsByStudent(rows.map((row) => row.id)));
    const students = new Map<string, ExistingStudent>();
    for (const row of rows) {
      const held = tags.get(row.id) ?? [];
      const names = (relation: string): Set<string> =>
        new Set(
          held.filter((tag) => tag.relation === relation).map((tag) => normalizeTag(tag.name)),
        );
      students.set(row.universityIdKey, {
        ...row,
        skills: names('SKILL'),
        interests: names('INTEREST'),
      });
    }
    const departments = this.#deps.students.departments(organizationId);
    const managing = departments.find((department) => department.isManaging) ?? departments[0];
    if (managing === undefined) throw new Error('the organization has no department');
    return { students, departments, managingDepartmentId: managing.id };
  }
}
