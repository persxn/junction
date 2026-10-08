import {
  STAGE_STATUS_LABELS,
  type ApplyDateChangesRequest,
  type MoveRequest,
  type StageAddRequest,
  type StageAssigneesRequest,
  type StageOverrideRequest,
  type StageStatusRequest,
  type StageUpdateRequest,
  type WorkflowView,
  StageAddRequest as StageAddSchema,
} from '@compintel/contracts';

import { resolveDueAt } from '../../domain/workflows/due.js';
import { studentRef } from '../../domain/students/records.js';
import { APP_TIMEZONE } from '../../platform/time.js';
import { uuid7 } from '../../platform/ids.js';
import {
  assigneeNotOnRoster,
  blockedReasonRequired,
  openTasks,
  workflowVersionConflict,
} from './errors.js';
import { WorkflowWriter } from './writer.js';
import { parseRule } from './templates-repo.js';
import type { WorkflowsContext } from './workflow-reader.js';

/**
 * A workflow's stages (§11, R99–R101): add, edit, remove and reorder — each
 * against the workflow's version — and the per-stage writes — status,
 * override, assignees, dates — against the stage's own. Every one is audited.
 */
export class StagesService extends WorkflowWriter {
  add(context: WorkflowsContext, competitionId: string, input: StageAddRequest): WorkflowView {
    const request = StageAddSchema.parse(input);
    const workflow = this.guard(context, competitionId, request.version);
    const id = uuid7();
    this.audited(
      context,
      competitionId,
      'workflow.stage_added',
      `Added the stage “${request.name}”`,
      { name: request.name },
      () => {
        const position = this.placeStage(workflow.id, request, id);
        const dueAt =
          request.dueAt === undefined || request.dueAt === null ? null : Date.parse(request.dueAt);
        this.deps.workflows.insertStage({
          id,
          workflowId: workflow.id,
          position,
          name: request.name,
          description: request.description ?? null,
          weight: request.weight,
          dueAt,
          dueRule: null,
          dueOrigin: dueAt === null ? 'NONE' : 'MANUAL',
        });
        this.deps.workflows.bumpWorkflow(workflow.id);
      },
    );
    return this.view(context, competitionId);
  }

  update(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    request: StageUpdateRequest,
  ): WorkflowView {
    const { stage } = this.guardStage(context, competitionId, stageId, request.version);
    const due =
      request.dueAt === undefined
        ? {}
        : request.dueAt === null
          ? { dueAt: null, dueOrigin: 'NONE' as const }
          : { dueAt: Date.parse(request.dueAt), dueOrigin: 'MANUAL' as const };
    this.audited(
      context,
      competitionId,
      'workflow.stage_updated',
      `Edited the stage “${stage.name}”`,
      { stageId, ...request },
      () => {
        this.deps.workflows.updateStage(stageId, {
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.description === undefined ? {} : { description: request.description }),
          ...(request.weight === undefined ? {} : { weight: request.weight }),
          ...(request.notes === undefined ? {} : { notes: request.notes }),
          ...due,
        });
      },
    );
    return this.view(context, competitionId);
  }

  remove(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    version: number,
  ): WorkflowView {
    const workflow = this.guard(context, competitionId, version);
    const stage = this.stageOf(workflow.id, stageId);
    this.audited(
      context,
      competitionId,
      'workflow.stage_removed',
      `Removed the stage “${stage.name}”`,
      { stageId },
      () => {
        this.deps.workflows.deleteStage(stageId);
        this.deps.workflows.bumpWorkflow(workflow.id);
      },
    );
    return this.view(context, competitionId);
  }

  move(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    request: MoveRequest,
  ): WorkflowView {
    const workflow = this.guard(context, competitionId, request.version);
    const stage = this.stageOf(workflow.id, stageId);
    this.audited(
      context,
      competitionId,
      'workflow.stage_moved',
      `Moved the stage “${stage.name}”`,
      { stageId, ...request },
      () => {
        const position = this.placeStage(workflow.id, request, stageId);
        this.deps.workflows.updateStage(stageId, { position }, false);
        this.deps.workflows.bumpWorkflow(workflow.id);
      },
    );
    return this.view(context, competitionId);
  }

  setStatus(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    request: StageStatusRequest,
  ): WorkflowView {
    const { stage } = this.guardStage(context, competitionId, stageId, request.version);
    const reason = request.blockedReason?.trim() ?? '';
    if (request.status === 'BLOCKED' && reason === '') throw blockedReasonRequired();
    const open = this.deps.workflows.tasks([stageId]).filter((task) => task.isDone === 0).length;
    if (
      request.status === 'COMPLETED' &&
      stage.status !== 'COMPLETED' &&
      open > 0 &&
      request.openTasks === undefined
    ) {
      throw openTasks(open);
    }
    const summary = `Marked the stage “${stage.name}” ${STAGE_STATUS_LABELS[request.status].toLowerCase()}`;
    const diff = {
      stageId,
      from: stage.status,
      to: request.status,
      openTasks: request.openTasks ?? null,
    };
    this.audited(context, competitionId, 'workflow.stage_status_changed', summary, diff, (at) => {
      const completing = request.status === 'COMPLETED' && stage.status !== 'COMPLETED';
      if (completing && open > 0 && request.openTasks === 'CLOSE') {
        this.deps.workflows.closeOpenTasks(stageId, context.actor.id, at);
      }
      this.deps.workflows.updateStage(stageId, {
        status: request.status,
        blockedReason: request.status === 'BLOCKED' ? reason : null,
        ...(request.status === 'IN_PROGRESS' && stage.startedAt === null ? { startedAt: at } : {}),
        ...(completing
          ? {
              completedAt: at,
              completedBy: context.actor.id,
              completedWithOpenTasks: open > 0 && request.openTasks === 'KEEP',
            }
          : {}),
        // Leaving COMPLETED clears when and by whom, and the flag.
        ...(stage.status === 'COMPLETED' && request.status !== 'COMPLETED'
          ? { completedAt: null, completedBy: null, completedWithOpenTasks: false }
          : {}),
      });
    });
    return this.view(context, competitionId);
  }

  setOverride(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    request: StageOverrideRequest,
  ): WorkflowView {
    const { stage } = this.guardStage(context, competitionId, stageId, request.version);
    const summary =
      request.progressOverride === null
        ? `Cleared the manual progress of “${stage.name}”`
        : `Set “${stage.name}” to ${String(request.progressOverride)}% by hand`;
    this.audited(
      context,
      competitionId,
      'workflow.stage_override',
      summary,
      { stageId, progressOverride: request.progressOverride },
      () => {
        this.deps.workflows.updateStage(stageId, { progressOverride: request.progressOverride });
      },
    );
    return this.view(context, competitionId);
  }

  setAssignees(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    request: StageAssigneesRequest,
  ): WorkflowView {
    const { stage } = this.guardStage(context, competitionId, stageId, request.version);
    const roster = new Set(this.deps.workflows.roster(competitionId).map((row) => row.studentId));
    if (request.studentIds.some((id) => !roster.has(id))) throw assigneeNotOnRoster();
    this.audited(
      context,
      competitionId,
      'workflow.stage_assignees_changed',
      `Changed who works on “${stage.name}”`,
      { stageId, students: request.studentIds.map(studentRef) },
      () => {
        this.deps.workflows.setAssignees(stageId, request.studentIds);
        this.deps.workflows.updateStage(stageId, {});
      },
    );
    return this.view(context, competitionId);
  }

  /** R100: a RULE date whose anchor moved, applied only when the user confirms it. */
  applyDateChanges(
    context: WorkflowsContext,
    competitionId: string,
    request: ApplyDateChangesRequest,
  ): WorkflowView {
    const workflow = this.guard(context, competitionId, request.version);
    const competition = this.reader.competition(competitionId);
    const dates = this.deps.templates.eventDates(competition.eventId);
    const stages = this.deps.workflows
      .stages([workflow.id])
      .filter((stage) => request.stageIds.includes(stage.id) && stage.dueOrigin === 'RULE');
    if (dates === undefined || stages.length === 0) throw workflowVersionConflict();
    this.audited(
      context,
      competitionId,
      'workflow.dates_updated',
      'Updated stage dates after the event deadline changed',
      { stages: stages.map((stage) => stage.id) },
      () => {
        for (const stage of stages) {
          const rule = parseRule(stage.dueRuleJson);
          const dueAt = rule === null ? null : resolveDueAt(rule, dates, APP_TIMEZONE);
          this.deps.workflows.updateStage(stage.id, { dueAt, dueOrigin: 'RULE' });
        }
        this.deps.workflows.bumpWorkflow(workflow.id);
      },
    );
    return this.view(context, competitionId);
  }
}
