import { z } from 'zod';

import { DeadlineKind } from './events.js';
import { Uuid7 } from './ids.js';

/**
 * Workflow enums and the due rule (§11, rulings R99–R101, roadmap WP-20a),
 * apart from the DTOs so the competitions contract can carry a health without
 * importing them.
 */

export const STAGE_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'BLOCKED',
  'SKIPPED',
] as const;
export const StageStatus = z.enum(STAGE_STATUSES);
export type StageStatus = z.infer<typeof StageStatus>;

export const STAGE_STATUS_LABELS: Readonly<Record<StageStatus, string>> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  BLOCKED: 'Blocked',
  SKIPPED: 'Skipped',
};

/** R99's "open" stages: the ones a schedule still waits on. */
export const OPEN_STAGE_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED',
] as const satisfies readonly StageStatus[];

/** R100's anchors: four `events` columns, or an `event_deadlines` row of a kind. */
export const DUE_ANCHORS = [
  'REGISTRATION_DEADLINE',
  'SUBMISSION_DEADLINE',
  'EVENT_START',
  'EVENT_END',
  'DEADLINE',
] as const;
export const DueAnchor = z.enum(DUE_ANCHORS);
export type DueAnchor = z.infer<typeof DueAnchor>;

export const DUE_ANCHOR_LABELS: Readonly<Record<DueAnchor, string>> = {
  REGISTRATION_DEADLINE: 'Registration deadline',
  SUBMISSION_DEADLINE: 'Submission deadline',
  EVENT_START: 'Event start',
  EVENT_END: 'Event end',
  DEADLINE: 'Event date of a kind',
};

export const DUE_OFFSET_MAX = 365;

export const DueRule = z
  .object({
    anchor: DueAnchor,
    /** Only with `DEADLINE`: which `event_deadlines` kind (the earliest such row). */
    kind: DeadlineKind.optional(),
    /** Calendar days in the display zone; negative is before the anchor. */
    offsetDays: z.int().min(-DUE_OFFSET_MAX).max(DUE_OFFSET_MAX),
  })
  .strict()
  .refine((rule) => (rule.anchor === 'DEADLINE') === (rule.kind !== undefined), {
    message: 'A DEADLINE anchor names a kind; the other anchors do not.',
  });
export type DueRule = z.infer<typeof DueRule>;

export const DUE_ORIGINS = ['RULE', 'MANUAL', 'NONE'] as const;
export const DueOrigin = z.enum(DUE_ORIGINS);
export type DueOrigin = z.infer<typeof DueOrigin>;

/** R99's five states, first match wins in this order. */
export const SCHEDULE_HEALTHS = ['BLOCKED', 'OVERDUE', 'AT_RISK', 'ON_TRACK', 'NO_DATES'] as const;
export const ScheduleHealth = z.enum(SCHEDULE_HEALTHS);
export type ScheduleHealth = z.infer<typeof ScheduleHealth>;

export const SCHEDULE_HEALTH_LABELS: Readonly<Record<ScheduleHealth, string>> = {
  BLOCKED: 'Blocked',
  OVERDUE: 'Overdue',
  AT_RISK: 'At risk',
  ON_TRACK: 'On track',
  NO_DATES: 'No dates',
};

/** "Mark the remaining N tasks done?" — Yes (CLOSE) or Complete anyway (KEEP). */
export const OPEN_TASK_CHOICES = ['CLOSE', 'KEEP'] as const;
export const OpenTaskChoice = z.enum(OPEN_TASK_CHOICES);
export type OpenTaskChoice = z.infer<typeof OpenTaskChoice>;

export const STAGE_WEIGHT_MAX = 10;
export const STAGE_NAME_MAX = 80;
export const TASK_TITLE_MAX = 160;
export const BLOCKED_REASON_MAX = 200;
export const TEMPLATE_NAME_MAX = 80;

/** The workflow choice made in the assign flow, or when Considering moves to Assigned (R98). */
export const WorkflowChoice = z
  .object({
    /** A template, or `null` for "Blank workflow". */
    templateId: Uuid7.nullable(),
    /** Review-dates edits, by template stage id: a date (→ MANUAL) or `null` (→ no date). */
    dueOverrides: z.record(z.string().min(1).max(64), z.iso.datetime().nullable()).default({}),
  })
  .strict();
export type WorkflowChoice = z.infer<typeof WorkflowChoice>;
export type WorkflowChoiceInput = z.input<typeof WorkflowChoice>;
