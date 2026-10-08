import type { DueOrigin, DueRule, StageStatus } from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';

/**
 * Every SQL statement about a competition's workflow (WP-20a; SQL only in
 * repositories): the workflow row, its stages, their tasks and assignees.
 * Stages and tasks are deleted only by an explicit removal, which is audited.
 */

const list = (values: readonly unknown[]): string => values.map(() => '?').join(', ');

export interface WorkflowRecord {
  readonly id: string;
  readonly engagementId: string;
  readonly templateId: string | null;
  readonly templateName: string | null;
  readonly templateVersionNo: number | null;
  readonly version: number;
}

export interface StageRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly position: number;
  readonly name: string;
  readonly description: string | null;
  readonly weight: number;
  readonly status: StageStatus;
  readonly blockedReason: string | null;
  readonly dueAt: number | null;
  readonly dueRuleJson: string | null;
  readonly dueOrigin: DueOrigin;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly completedBy: string | null;
  readonly progressOverride: number | null;
  readonly completedWithOpenTasks: number;
  readonly notes: string | null;
  readonly version: number;
}

export interface TaskRecord {
  readonly id: string;
  readonly stageId: string;
  readonly position: number;
  readonly title: string;
  readonly isDone: number;
  readonly doneAt: number | null;
  readonly doneBy: string | null;
  readonly assigneeStudentId: string | null;
  readonly assigneeName: string | null;
  readonly dueAt: number | null;
  readonly notes: string | null;
}

const STAGE_COLUMNS = `id, workflow_id AS workflowId, position, name, description, weight, status,
  blocked_reason AS blockedReason, due_at AS dueAt, due_rule_json AS dueRuleJson,
  due_origin AS dueOrigin, started_at AS startedAt, completed_at AS completedAt,
  (SELECT display_name FROM users u WHERE u.id = completed_by) AS completedBy,
  progress_override AS progressOverride, completed_with_open_tasks AS completedWithOpenTasks,
  notes, version`;

export type StageChange = Partial<{
  name: string;
  description: string | null;
  weight: number;
  status: StageStatus;
  blockedReason: string | null;
  dueAt: number | null;
  dueOrigin: DueOrigin;
  startedAt: number | null;
  completedAt: number | null;
  completedBy: string | null;
  progressOverride: number | null;
  completedWithOpenTasks: boolean;
  notes: string | null;
  position: number;
}>;

const STAGE_FIELDS: Record<keyof StageChange, string> = {
  name: 'name',
  description: 'description',
  weight: 'weight',
  status: 'status',
  blockedReason: 'blocked_reason',
  dueAt: 'due_at',
  dueOrigin: 'due_origin',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  completedBy: 'completed_by',
  progressOverride: 'progress_override',
  completedWithOpenTasks: 'completed_with_open_tasks',
  notes: 'notes',
  position: 'position',
};

export class WorkflowRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  forCompetition(engagementId: string): WorkflowRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT w.id, w.engagement_id AS engagementId, w.template_id AS templateId, t.name AS templateName,
           w.template_version_no AS templateVersionNo, w.version
         FROM workflows w LEFT JOIN workflow_templates t ON t.id = w.template_id
         WHERE w.engagement_id = ?`,
      )
      .get(engagementId) as WorkflowRecord | undefined;
  }

  insertWorkflow(row: {
    id: string;
    engagementId: string;
    templateId: string | null;
    templateVersionNo: number | null;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO workflows (id, engagement_id, template_id, template_version_no, created_at, version)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(row.id, row.engagementId, row.templateId, row.templateVersionNo, row.at);
  }

  bumpWorkflow(id: string): void {
    this.#db.raw.prepare('UPDATE workflows SET version = version + 1 WHERE id = ?').run(id);
  }

  stages(workflowIds: readonly string[]): StageRecord[] {
    if (workflowIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT ${STAGE_COLUMNS} FROM workflow_stages WHERE workflow_id IN (${list(workflowIds)}) ORDER BY position, id`,
      )
      .all(...workflowIds) as StageRecord[];
  }

  stage(id: string): StageRecord | undefined {
    return this.#db.raw
      .prepare(`SELECT ${STAGE_COLUMNS} FROM workflow_stages WHERE id = ?`)
      .get(id) as StageRecord | undefined;
  }

  insertStage(row: {
    id: string;
    workflowId: string;
    position: number;
    name: string;
    description: string | null;
    weight: number;
    dueAt: number | null;
    dueRule: DueRule | null;
    dueOrigin: DueOrigin;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO workflow_stages (id, workflow_id, position, name, description, weight, status,
           due_at, due_rule_json, due_origin, version)
         VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?, ?, ?, 1)`,
      )
      .run(
        row.id,
        row.workflowId,
        row.position,
        row.name,
        row.description,
        row.weight,
        row.dueAt,
        row.dueRule === null ? null : JSON.stringify(row.dueRule),
        row.dueOrigin,
      );
  }

  /** Applies the change and bumps the stage's version (every stage write does). */
  updateStage(id: string, change: StageChange, bump = true): void {
    const sets = bump ? ['version = version + 1'] : [];
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(change) as [keyof StageChange, unknown][]) {
      if (value === undefined) continue;
      sets.push(`${STAGE_FIELDS[key]} = ?`);
      args.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return;
    this.#db.raw
      .prepare(`UPDATE workflow_stages SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args, id);
  }

  deleteStage(id: string): void {
    this.#db.raw.prepare('DELETE FROM workflow_stages WHERE id = ?').run(id);
  }

  tasks(stageIds: readonly string[]): TaskRecord[] {
    if (stageIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT t.id, t.stage_id AS stageId, t.position, t.title, t.is_done AS isDone, t.done_at AS doneAt,
           u.display_name AS doneBy, t.assignee_student_id AS assigneeStudentId,
           CASE WHEN s.erased_at IS NULL THEN s.full_name ELSE 'Erased student' END AS assigneeName,
           t.due_at AS dueAt, t.notes
         FROM tasks t LEFT JOIN users u ON u.id = t.done_by
         LEFT JOIN students s ON s.id = t.assignee_student_id
         WHERE t.stage_id IN (${list(stageIds)}) ORDER BY t.position, t.id`,
      )
      .all(...stageIds) as TaskRecord[];
  }

  taskStage(taskId: string): string | undefined {
    const row = this.#db.raw
      .prepare('SELECT stage_id AS stageId FROM tasks WHERE id = ?')
      .get(taskId) as { stageId: string } | undefined;
    return row?.stageId;
  }

  insertTask(row: {
    id: string;
    stageId: string;
    position: number;
    title: string;
    assigneeStudentId: string | null;
    dueAt: number | null;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO tasks (id, stage_id, position, title, is_done, assignee_student_id, due_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(row.id, row.stageId, row.position, row.title, row.assigneeStudentId, row.dueAt);
  }

  updateTask(
    id: string,
    change: Partial<{
      title: string;
      assigneeStudentId: string | null;
      dueAt: number | null;
      notes: string | null;
      position: number;
    }>,
  ): void {
    const fields: Record<string, string> = {
      title: 'title',
      assigneeStudentId: 'assignee_student_id',
      dueAt: 'due_at',
      notes: 'notes',
      position: 'position',
    };
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) continue;
      sets.push(`${fields[key] ?? key} = ?`);
      args.push(value);
    }
    if (sets.length === 0) return;
    this.#db.raw.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }

  setTaskDone(id: string, done: boolean, by: string, at: number): void {
    this.#db.raw
      .prepare('UPDATE tasks SET is_done = ?, done_at = ?, done_by = ? WHERE id = ?')
      .run(done ? 1 : 0, done ? at : null, done ? by : null, id);
  }

  closeOpenTasks(stageId: string, by: string, at: number): number {
    return this.#db.raw
      .prepare(
        'UPDATE tasks SET is_done = 1, done_at = ?, done_by = ? WHERE stage_id = ? AND is_done = 0',
      )
      .run(at, by, stageId).changes;
  }

  deleteTask(id: string): void {
    this.#db.raw.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  assignees(
    stageIds: readonly string[],
  ): { stageId: string; studentId: string; fullName: string }[] {
    if (stageIds.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT a.stage_id AS stageId, a.student_id AS studentId,
           CASE WHEN s.erased_at IS NULL THEN s.full_name ELSE 'Erased student' END AS fullName
         FROM stage_assignees a JOIN students s ON s.id = a.student_id
         WHERE a.stage_id IN (${list(stageIds)}) ORDER BY lower(s.full_name)`,
      )
      .all(...stageIds) as { stageId: string; studentId: string; fullName: string }[];
  }

  setAssignees(stageId: string, studentIds: readonly string[]): void {
    this.#db.raw.prepare('DELETE FROM stage_assignees WHERE stage_id = ?').run(stageId);
    const insert = this.#db.raw.prepare(
      'INSERT INTO stage_assignees (stage_id, student_id) VALUES (?, ?)',
    );
    for (const studentId of new Set(studentIds)) insert.run(stageId, studentId);
  }

  /** The competition's open roster, for the assignee pickers and checks. */
  roster(engagementId: string): { studentId: string; fullName: string }[] {
    return this.#db.raw
      .prepare(
        `SELECT p.student_id AS studentId,
           CASE WHEN s.erased_at IS NULL THEN s.full_name ELSE 'Erased student' END AS fullName
         FROM engagement_participants p JOIN students s ON s.id = p.student_id
         WHERE p.engagement_id = ? AND p.removed_at IS NULL ORDER BY lower(s.full_name)`,
      )
      .all(engagementId) as { studentId: string; fullName: string }[];
  }
}
