import { z } from 'zod';

import { Uuid7 } from './ids.js';
import {
  BLOCKED_REASON_MAX,
  DueOrigin,
  DueRule,
  OpenTaskChoice,
  ScheduleHealth,
  StageStatus,
  STAGE_NAME_MAX,
  STAGE_WEIGHT_MAX,
  TASK_TITLE_MAX,
} from './workflow-enums.js';

/**
 * A competition's workflow (§11, R99–R101): its stages in order, each with
 * tasks, assignees and a due date; the computed progress and schedule health,
 * each with its reason; and R100's "event deadline changed" offers.
 */

const Iso = z.iso.datetime();
const Version = z.int().min(1);

export const WorkflowTask = z
  .object({
    id: Uuid7,
    title: z.string().min(1),
    isDone: z.boolean(),
    doneAt: Iso.nullable(),
    doneBy: z.string().nullable(),
    assigneeStudentId: Uuid7.nullable(),
    assigneeName: z.string().nullable(),
    dueAt: Iso.nullable(),
    notes: z.string().nullable(),
  })
  .strict();
export type WorkflowTask = z.infer<typeof WorkflowTask>;

export const WorkflowStage = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    description: z.string().nullable(),
    weight: z.int().min(0).max(STAGE_WEIGHT_MAX),
    status: StageStatus,
    blockedReason: z.string().nullable(),
    dueAt: Iso.nullable(),
    dueOrigin: DueOrigin,
    dueRule: DueRule.nullable(),
    startedAt: Iso.nullable(),
    completedAt: Iso.nullable(),
    completedBy: z.string().nullable(),
    progressOverride: z.int().min(0).max(100).nullable(),
    completedWithOpenTasks: z.boolean(),
    notes: z.string().nullable(),
    /** R99's stage progress, 0–100; `null` for a SKIPPED stage (it is not counted). */
    progress: z.number().min(0).max(100).nullable(),
    /** Derived, never a status (§11): open and past its date. */
    overdue: z.boolean(),
    assignees: z.array(z.object({ studentId: Uuid7, fullName: z.string().min(1) }).strict()),
    tasks: z.array(WorkflowTask),
    version: Version,
  })
  .strict();
export type WorkflowStage = z.infer<typeof WorkflowStage>;

/** R100: a RULE date whose anchor moved, offered back — never applied silently. */
export const DateChange = z
  .object({
    stageId: Uuid7,
    stageName: z.string().min(1),
    current: Iso.nullable(),
    proposed: Iso.nullable(),
  })
  .strict();
export type DateChange = z.infer<typeof DateChange>;

export const WorkflowView = z
  .object({
    id: Uuid7,
    competitionId: Uuid7,
    templateId: Uuid7.nullable(),
    templateName: z.string().nullable(),
    templateVersionNo: z.int().min(1).nullable(),
    /** R99: `null` when nothing is counted, with `progressReason` saying why — never 0 %. */
    progress: z.number().min(0).max(100).nullable(),
    progressReason: z.string().nullable(),
    /** `null` for a COMPLETED, WITHDRAWN or NOT_SELECTED competition (R99). */
    health: ScheduleHealth.nullable(),
    healthReason: z.string(),
    stages: z.array(WorkflowStage),
    dateChanges: z.array(DateChange),
    /** The roster, for the assignee pickers (only active roster members may be assigned). */
    roster: z.array(z.object({ studentId: Uuid7, fullName: z.string().min(1) }).strict()),
    canEdit: z.boolean(),
    version: Version,
  })
  .strict();
export type WorkflowView = z.infer<typeof WorkflowView>;

const StageName = z.string().trim().min(1).max(STAGE_NAME_MAX);

export const StageAddRequest = z
  .object({
    name: StageName,
    description: z.string().trim().max(500).nullish(),
    weight: z.int().min(0).max(STAGE_WEIGHT_MAX).default(1),
    dueAt: Iso.nullish(),
    beforeId: Uuid7.optional(),
    afterId: Uuid7.optional(),
    /** The workflow's version: adding changes its shape. */
    version: Version,
  })
  .strict();
export type StageAddRequest = z.input<typeof StageAddRequest>;

export const StageUpdateRequest = z
  .object({
    name: StageName.optional(),
    description: z.string().trim().max(500).nullish(),
    weight: z.int().min(0).max(STAGE_WEIGHT_MAX).optional(),
    notes: z.string().trim().max(2000).nullish(),
    /** A person's date (→ MANUAL), or `null` to clear it (→ NONE). */
    dueAt: Iso.nullish(),
    version: Version,
  })
  .strict();
export type StageUpdateRequest = z.infer<typeof StageUpdateRequest>;

export const StageStatusRequest = z
  .object({
    status: StageStatus,
    blockedReason: z.string().trim().max(BLOCKED_REASON_MAX).optional(),
    /** Required to complete a stage with open tasks (else 422 `WORKFLOW_OPEN_TASKS`). */
    openTasks: OpenTaskChoice.optional(),
    version: Version,
  })
  .strict();
export type StageStatusRequest = z.infer<typeof StageStatusRequest>;

export const StageOverrideRequest = z
  .object({ progressOverride: z.int().min(0).max(100).nullable(), version: Version })
  .strict();
export type StageOverrideRequest = z.infer<typeof StageOverrideRequest>;

export const StageAssigneesRequest = z
  .object({ studentIds: z.array(Uuid7).max(50), version: Version })
  .strict();
export type StageAssigneesRequest = z.infer<typeof StageAssigneesRequest>;

export const MoveRequest = z
  .object({ beforeId: Uuid7.optional(), afterId: Uuid7.optional(), version: Version })
  .strict();
export type MoveRequest = z.infer<typeof MoveRequest>;

export const VersionRequest = z.object({ version: Version }).strict();
export type VersionRequest = z.infer<typeof VersionRequest>;

const TaskTitle = z.string().trim().min(1).max(TASK_TITLE_MAX);

export const TaskAddRequest = z
  .object({
    title: TaskTitle,
    assigneeStudentId: Uuid7.nullish(),
    dueAt: Iso.nullish(),
    /** The stage's version. */
    version: Version,
  })
  .strict();
export type TaskAddRequest = z.infer<typeof TaskAddRequest>;

export const TaskUpdateRequest = z
  .object({
    title: TaskTitle.optional(),
    assigneeStudentId: Uuid7.nullish(),
    dueAt: Iso.nullish(),
    notes: z.string().trim().max(1000).nullish(),
    version: Version,
  })
  .strict();
export type TaskUpdateRequest = z.infer<typeof TaskUpdateRequest>;

/** An explicit value, never a toggle (WP-20a step 7). */
export const TaskDoneRequest = z.object({ done: z.boolean(), version: Version }).strict();
export type TaskDoneRequest = z.infer<typeof TaskDoneRequest>;

export const ApplyDateChangesRequest = z
  .object({ stageIds: z.array(Uuid7).min(1).max(50), version: Version })
  .strict();
export type ApplyDateChangesRequest = z.infer<typeof ApplyDateChangesRequest>;
