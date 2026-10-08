import {
  type TemplateCloneRequest,
  type TemplateMoveRequest,
  type TemplateStageAddRequest,
  type TemplateStageUpdateRequest,
  type TemplateUpdateRequest,
  type WorkflowTemplateDetail,
  type WorkflowTemplateList,
  type WorkflowTemplateSummary,
  TemplateStageAddRequest as TemplateStageAddSchema,
} from '@compintel/contracts';

import { place } from '../../domain/workflows/order.js';
import { withAudit } from '../../platform/audit.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import type { AuditLog } from '../../platform/audit.js';
import { assertCan, can } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import {
  stageNotFound,
  templateNotFound,
  templateReadOnly,
  workflowVersionConflict,
} from './errors.js';
import {
  parseRule,
  parseTasks,
  type TemplateRecord,
  type TemplatesRepository,
} from './templates-repo.js';

/**
 * Workflow templates (§10.2 "Workflow templates", §11, R101): the defaults are
 * the department's and only an administrator changes them; a professor clones
 * any template and edits only his own. Every edit bumps `versionNo`, which is
 * also the version a client must send — stale → 409, nothing written. Existing
 * workflows never change when their template does: they were copies.
 */

export interface TemplatesContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface TemplatesDependencies {
  readonly templates: TemplatesRepository;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export class TemplatesService {
  readonly #deps: TemplatesDependencies;
  readonly #clock: Clock;

  constructor(deps: TemplatesDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  /** §10.2: a default is the admin's; a clone is its owner's (or an admin's). */
  canEdit(actor: Principal, template: TemplateRecord): boolean {
    if (can(actor, 'workflow_template.manage_all')) return true;
    if (template.createdBy === null) return false;
    return can(actor, 'workflow_template.manage_own', { isOwner: template.createdBy === actor.id });
  }

  #summary(actor: Principal, row: TemplateRecord): WorkflowTemplateSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      appliesToEventType: row.appliesToEventType,
      isDefaultForType: row.isDefaultForType === 1,
      isDepartmentDefault: row.createdBy === null,
      ownerName: row.ownerName,
      ownedByMe: row.createdBy === actor.id,
      isArchived: row.isArchived === 1,
      versionNo: row.versionNo,
      stageCount: row.stageCount,
      canEdit: this.canEdit(actor, row),
    };
  }

  list(context: TemplatesContext): WorkflowTemplateList {
    assertCan(context.actor, 'competition.view');
    return { items: this.#deps.templates.list().map((row) => this.#summary(context.actor, row)) };
  }

  get(context: TemplatesContext, id: string): WorkflowTemplateDetail {
    assertCan(context.actor, 'competition.view');
    const row = this.#deps.templates.find(id);
    if (row === undefined) throw templateNotFound();
    return {
      ...this.#summary(context.actor, row),
      stages: this.#deps.templates.stages(id).map((stage) => ({
        id: stage.id,
        name: stage.name,
        description: stage.description,
        weight: stage.weight,
        dueRule: parseRule(stage.dueRuleJson),
        defaultTasks: parseTasks(stage.defaultTasksJson),
      })),
    };
  }

  clone(
    context: TemplatesContext,
    id: string,
    request: TemplateCloneRequest,
  ): WorkflowTemplateDetail {
    assertCan(context.actor, 'workflow_template.clone');
    const source = this.#deps.templates.find(id);
    if (source === undefined) throw templateNotFound();
    const copy = uuid7();
    const at = nowMs(this.#clock);
    this.#audited(
      context,
      copy,
      'workflow_template.cloned',
      `Cloned the template “${source.name}”`,
      { from: id },
      () => {
        this.#deps.templates.insertTemplate({
          id: copy,
          departmentId: source.departmentId,
          name: request.name ?? `${source.name} (my copy)`,
          description: source.description,
          appliesToEventType: source.appliesToEventType,
          createdBy: context.actor.id,
          at,
        });
        for (const stage of this.#deps.templates.stages(id)) {
          this.#deps.templates.insertStage({
            id: uuid7(),
            templateId: copy,
            position: stage.position,
            name: stage.name,
            description: stage.description,
            weight: stage.weight,
            dueRule: parseRule(stage.dueRuleJson),
            defaultTasks: parseTasks(stage.defaultTasksJson),
          });
        }
      },
    );
    return this.get(context, copy);
  }

  update(
    context: TemplatesContext,
    id: string,
    request: TemplateUpdateRequest,
  ): WorkflowTemplateDetail {
    const row = this.#editable(context, id, request.versionNo);
    if (
      request.isDefaultForType !== undefined &&
      !can(context.actor, 'workflow_template.manage_all')
    ) {
      throw templateReadOnly(
        'Only an administrator chooses the default template for an event type.',
      );
    }
    const at = nowMs(this.#clock);
    const type =
      request.appliesToEventType === undefined
        ? row.appliesToEventType
        : request.appliesToEventType;
    this.#audited(
      context,
      id,
      'workflow_template.updated',
      `Edited the template “${row.name}”`,
      { ...request },
      () => {
        if (request.isDefaultForType === true && type !== null) {
          this.#deps.templates.clearDefault(row.departmentId, type, at);
        }
        this.#deps.templates.touch(id, at, {
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.description === undefined ? {} : { description: request.description }),
          ...(request.appliesToEventType === undefined
            ? {}
            : { appliesToEventType: request.appliesToEventType }),
          ...(request.isDefaultForType === undefined
            ? {}
            : { isDefaultForType: request.isDefaultForType }),
        });
      },
    );
    return this.get(context, id);
  }

  archive(context: TemplatesContext, id: string, versionNo: number): WorkflowTemplateDetail {
    const row = this.#editable(context, id, versionNo);
    this.#audited(
      context,
      id,
      'workflow_template.archived',
      `Archived the template “${row.name}”`,
      {},
      () => {
        this.#deps.templates.touch(id, nowMs(this.#clock), {
          isArchived: true,
          isDefaultForType: false,
        });
      },
    );
    return this.get(context, id);
  }

  addStage(
    context: TemplatesContext,
    id: string,
    input: TemplateStageAddRequest,
  ): WorkflowTemplateDetail {
    const request = TemplateStageAddSchema.parse(input);
    const row = this.#editable(context, id, request.versionNo);
    const stageId = uuid7();
    this.#audited(
      context,
      id,
      'workflow_template.stage_added',
      `Added a stage to “${row.name}”`,
      { name: request.name },
      () => {
        const position = this.#position(
          id,
          { beforeId: request.beforeId, afterId: request.afterId },
          stageId,
        );
        this.#deps.templates.insertStage({
          id: stageId,
          templateId: id,
          position,
          name: request.name,
          description: request.description ?? null,
          weight: request.weight,
          dueRule: request.dueRule,
          defaultTasks: request.defaultTasks,
        });
        this.#deps.templates.touch(id, nowMs(this.#clock));
      },
    );
    return this.get(context, id);
  }

  updateStage(
    context: TemplatesContext,
    id: string,
    stageId: string,
    request: TemplateStageUpdateRequest,
  ): WorkflowTemplateDetail {
    const row = this.#editable(context, id, request.versionNo);
    this.#requireStage(id, stageId);
    const { versionNo: _version, ...change } = request;
    this.#audited(
      context,
      id,
      'workflow_template.stage_updated',
      `Edited a stage of “${row.name}”`,
      { stageId, ...change },
      () => {
        this.#deps.templates.updateStage(stageId, {
          ...(change.name === undefined ? {} : { name: change.name }),
          ...(change.description === undefined ? {} : { description: change.description }),
          ...(change.weight === undefined ? {} : { weight: change.weight }),
          ...(change.dueRule === undefined ? {} : { dueRule: change.dueRule }),
          ...(change.defaultTasks === undefined ? {} : { defaultTasks: change.defaultTasks }),
        });
        this.#deps.templates.touch(id, nowMs(this.#clock));
      },
    );
    return this.get(context, id);
  }

  removeStage(
    context: TemplatesContext,
    id: string,
    stageId: string,
    versionNo: number,
  ): WorkflowTemplateDetail {
    const row = this.#editable(context, id, versionNo);
    this.#requireStage(id, stageId);
    this.#audited(
      context,
      id,
      'workflow_template.stage_removed',
      `Removed a stage from “${row.name}”`,
      { stageId },
      () => {
        this.#deps.templates.deleteStage(stageId);
        this.#deps.templates.touch(id, nowMs(this.#clock));
      },
    );
    return this.get(context, id);
  }

  moveStage(
    context: TemplatesContext,
    id: string,
    stageId: string,
    request: TemplateMoveRequest,
  ): WorkflowTemplateDetail {
    const row = this.#editable(context, id, request.versionNo);
    this.#requireStage(id, stageId);
    this.#audited(
      context,
      id,
      'workflow_template.stage_moved',
      `Reordered the stages of “${row.name}”`,
      { stageId },
      () => {
        const position = this.#position(
          id,
          { beforeId: request.beforeId, afterId: request.afterId },
          stageId,
        );
        this.#deps.templates.updateStage(stageId, { position });
        this.#deps.templates.touch(id, nowMs(this.#clock));
      },
    );
    return this.get(context, id);
  }

  /** R101: the server's midpoint, renumbering the template's stages when the gap closes. */
  #position(
    templateId: string,
    placement: { beforeId: string | undefined; afterId: string | undefined },
    itemId: string,
  ): number {
    const others = this.#deps.templates.stages(templateId).filter((stage) => stage.id !== itemId);
    const result = place(
      others,
      {
        ...(placement.beforeId === undefined ? {} : { beforeId: placement.beforeId }),
        ...(placement.afterId === undefined ? {} : { afterId: placement.afterId }),
      },
      itemId,
    );
    for (const row of result.renumbered ?? []) {
      if (row.id !== itemId) this.#deps.templates.updateStage(row.id, { position: row.position });
    }
    return result.position;
  }

  #requireStage(templateId: string, stageId: string): void {
    if (!this.#deps.templates.stages(templateId).some((stage) => stage.id === stageId))
      throw stageNotFound();
  }

  #editable(context: TemplatesContext, id: string, versionNo: number): TemplateRecord {
    const row = this.#deps.templates.find(id);
    if (row === undefined) throw templateNotFound();
    if (!this.canEdit(context.actor, row)) {
      throw templateReadOnly(
        row.createdBy === null
          ? 'This is a department default; only an administrator can change it.'
          : 'Only the professor who made this template can change it.',
      );
    }
    if (row.versionNo !== versionNo) throw workflowVersionConflict();
    return row;
  }

  #audited(
    context: TemplatesContext,
    id: string,
    action: string,
    summary: string,
    diff: Record<string, unknown>,
    work: () => void,
  ): void {
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action,
        entityKind: 'workflow_template',
        entityId: id,
        summary,
        diff,
        requestId: context.requestId ?? null,
      },
      work,
    );
  }
}
