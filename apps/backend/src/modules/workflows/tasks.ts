import type {
  MoveRequest,
  TaskAddRequest,
  TaskDoneRequest,
  TaskUpdateRequest,
  WorkflowView,
} from '@compintel/contracts';

import { place } from '../../domain/workflows/order.js';
import { studentRef } from '../../domain/students/records.js';
import { uuid7 } from '../../platform/ids.js';
import { assigneeNotOnRoster, taskNotFound } from './errors.js';
import type { WorkflowsContext } from './workflow-reader.js';
import type { TaskRecord } from './workflow-repo.js';
import { WorkflowWriter } from './writer.js';

/**
 * A stage's tasks (§11): add, edit, reorder, remove, and done set to an
 * explicit value — never a toggle, so a repeated click cannot undo itself.
 * Each write is checked against its stage's version and bumps it. Ticking the
 * first task of a NOT_STARTED stage starts the stage.
 */
export class TasksService extends WorkflowWriter {
  add(
    context: WorkflowsContext,
    competitionId: string,
    stageId: string,
    request: TaskAddRequest,
  ): WorkflowView {
    const { stage } = this.guardStage(context, competitionId, stageId, request.version);
    this.#onRoster(competitionId, request.assigneeStudentId);
    const id = uuid7();
    this.audited(
      context,
      competitionId,
      'workflow.task_added',
      `Added a task to “${stage.name}”`,
      { stageId },
      () => {
        const position = this.#place(stageId, {}, id);
        this.deps.workflows.insertTask({
          id,
          stageId,
          position,
          title: request.title,
          assigneeStudentId: request.assigneeStudentId ?? null,
          dueAt:
            request.dueAt === undefined || request.dueAt === null
              ? null
              : Date.parse(request.dueAt),
        });
        this.deps.workflows.updateStage(stageId, {});
      },
    );
    return this.view(context, competitionId);
  }

  update(
    context: WorkflowsContext,
    competitionId: string,
    taskId: string,
    request: TaskUpdateRequest,
  ): WorkflowView {
    const task = this.#task(taskId);
    const { stage } = this.guardStage(context, competitionId, task.stageId, request.version);
    this.#onRoster(competitionId, request.assigneeStudentId);
    const diff = {
      taskId,
      ...(request.assigneeStudentId === undefined
        ? {}
        : {
            assignee:
              request.assigneeStudentId === null ? null : studentRef(request.assigneeStudentId),
          }),
      ...(request.title === undefined ? {} : { title: request.title }),
    };
    this.audited(
      context,
      competitionId,
      'workflow.task_updated',
      `Edited a task of “${stage.name}”`,
      diff,
      () => {
        this.deps.workflows.updateTask(taskId, {
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.assigneeStudentId === undefined
            ? {}
            : { assigneeStudentId: request.assigneeStudentId }),
          ...(request.dueAt === undefined
            ? {}
            : { dueAt: request.dueAt === null ? null : Date.parse(request.dueAt) }),
          ...(request.notes === undefined ? {} : { notes: request.notes }),
        });
        this.deps.workflows.updateStage(task.stageId, {});
      },
    );
    return this.view(context, competitionId);
  }

  move(
    context: WorkflowsContext,
    competitionId: string,
    taskId: string,
    request: MoveRequest,
  ): WorkflowView {
    const task = this.#task(taskId);
    const { stage } = this.guardStage(context, competitionId, task.stageId, request.version);
    this.audited(
      context,
      competitionId,
      'workflow.task_moved',
      `Reordered the tasks of “${stage.name}”`,
      { taskId, ...request },
      () => {
        const position = this.#place(task.stageId, request, taskId);
        this.deps.workflows.updateTask(taskId, { position });
        this.deps.workflows.updateStage(task.stageId, {});
      },
    );
    return this.view(context, competitionId);
  }

  remove(
    context: WorkflowsContext,
    competitionId: string,
    taskId: string,
    version: number,
  ): WorkflowView {
    const task = this.#task(taskId);
    const { stage } = this.guardStage(context, competitionId, task.stageId, version);
    this.audited(
      context,
      competitionId,
      'workflow.task_removed',
      `Removed a task from “${stage.name}”`,
      { taskId, title: task.title },
      () => {
        this.deps.workflows.deleteTask(taskId);
        this.deps.workflows.updateStage(task.stageId, {});
      },
    );
    return this.view(context, competitionId);
  }

  setDone(
    context: WorkflowsContext,
    competitionId: string,
    taskId: string,
    request: TaskDoneRequest,
  ): WorkflowView {
    const task = this.#task(taskId);
    const { stage } = this.guardStage(context, competitionId, task.stageId, request.version);
    const summary = `${request.done ? 'Ticked' : 'Unticked'} a task of “${stage.name}”`;
    this.audited(
      context,
      competitionId,
      'workflow.task_done',
      summary,
      { taskId, done: request.done },
      (at) => {
        this.deps.workflows.setTaskDone(taskId, request.done, context.actor.id, at);
        const starts = request.done && stage.status === 'NOT_STARTED';
        this.deps.workflows.updateStage(
          task.stageId,
          starts
            ? { status: 'IN_PROGRESS', ...(stage.startedAt === null ? { startedAt: at } : {}) }
            : {},
        );
      },
    );
    return this.view(context, competitionId);
  }

  #task(taskId: string): TaskRecord {
    const stageId = this.deps.workflows.taskStage(taskId);
    if (stageId === undefined) throw taskNotFound();
    const task = this.deps.workflows.tasks([stageId]).find((row) => row.id === taskId);
    if (task === undefined) throw taskNotFound();
    return task;
  }

  #onRoster(competitionId: string, studentId: string | null | undefined): void {
    if (studentId === undefined || studentId === null) return;
    if (!this.deps.workflows.roster(competitionId).some((row) => row.studentId === studentId)) {
      throw assigneeNotOnRoster();
    }
  }

  #place(
    stageId: string,
    placement: { beforeId?: string | undefined; afterId?: string | undefined },
    itemId: string,
  ): number {
    const others = this.deps.workflows.tasks([stageId]).filter((row) => row.id !== itemId);
    const result = place(
      others,
      {
        ...(placement.beforeId === undefined ? {} : { beforeId: placement.beforeId }),
        ...(placement.afterId === undefined ? {} : { afterId: placement.afterId }),
      },
      itemId,
    );
    for (const row of result.renumbered ?? []) {
      if (row.id !== itemId) this.deps.workflows.updateTask(row.id, { position: row.position });
    }
    return result.position;
  }
}
