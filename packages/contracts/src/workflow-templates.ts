import { z } from 'zod';

import { EventType } from './enums.js';
import { Uuid7 } from './ids.js';
import {
  DueRule,
  STAGE_NAME_MAX,
  STAGE_WEIGHT_MAX,
  TASK_TITLE_MAX,
  TEMPLATE_NAME_MAX,
} from './workflow-enums.js';

/**
 * Workflow templates (§11, §10.2 "Workflow templates", R101): the five seeded
 * department defaults, and the copies professors clone and edit. A template's
 * `versionNo` is both its edit count and its optimistic-concurrency version.
 */

export const TEMPLATE_STAGES_MAX = 20;
export const DEFAULT_TASKS_MAX = 10;

const StageName = z.string().trim().min(1).max(STAGE_NAME_MAX);
const Weight = z.int().min(0).max(STAGE_WEIGHT_MAX);
const TaskTitles = z.array(z.string().trim().min(1).max(TASK_TITLE_MAX)).max(DEFAULT_TASKS_MAX);
const VersionNo = z.int().min(1);

export const TemplateStage = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    description: z.string().nullable(),
    weight: Weight,
    dueRule: DueRule.nullable(),
    defaultTasks: z.array(z.string()),
  })
  .strict();
export type TemplateStage = z.infer<typeof TemplateStage>;

export const WorkflowTemplateSummary = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    description: z.string().nullable(),
    appliesToEventType: EventType.nullable(),
    isDefaultForType: z.boolean(),
    /** One of the five seeded department defaults (no owner). */
    isDepartmentDefault: z.boolean(),
    ownerName: z.string().nullable(),
    ownedByMe: z.boolean(),
    isArchived: z.boolean(),
    versionNo: VersionNo,
    stageCount: z.int().min(0),
    /** The caller may edit it (§10.2) — cosmetic, the server decides again. */
    canEdit: z.boolean(),
  })
  .strict();
export type WorkflowTemplateSummary = z.infer<typeof WorkflowTemplateSummary>;

export const WorkflowTemplateDetail = WorkflowTemplateSummary.extend({
  stages: z.array(TemplateStage),
}).strict();
export type WorkflowTemplateDetail = z.infer<typeof WorkflowTemplateDetail>;

export const WorkflowTemplateList = z.object({ items: z.array(WorkflowTemplateSummary) }).strict();
export type WorkflowTemplateList = z.infer<typeof WorkflowTemplateList>;

export const TemplateCloneRequest = z
  .object({ name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX).optional() })
  .strict();
export type TemplateCloneRequest = z.infer<typeof TemplateCloneRequest>;

export const TemplateUpdateRequest = z
  .object({
    name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX).optional(),
    description: z.string().trim().max(500).nullish(),
    appliesToEventType: EventType.nullish(),
    /** Admin only (§10.2): the template preselected for its event type. */
    isDefaultForType: z.boolean().optional(),
    versionNo: VersionNo,
  })
  .strict();
export type TemplateUpdateRequest = z.infer<typeof TemplateUpdateRequest>;

export const TemplateStageInput = z
  .object({
    name: StageName,
    description: z.string().trim().max(500).nullish(),
    weight: Weight.default(1),
    dueRule: DueRule.nullable().default(null),
    defaultTasks: TaskTitles.default([]),
  })
  .strict();

/** Where a stage goes: just after one, or just before one; neither → the end. */
export const Placement = z
  .object({ beforeId: Uuid7.optional(), afterId: Uuid7.optional() })
  .strict()
  .refine((place) => place.beforeId === undefined || place.afterId === undefined, {
    message: 'Give beforeId or afterId, not both.',
  });
export type Placement = z.infer<typeof Placement>;

export const TemplateStageAddRequest = TemplateStageInput.extend({
  beforeId: Uuid7.optional(),
  afterId: Uuid7.optional(),
  versionNo: VersionNo,
}).strict();
export type TemplateStageAddRequest = z.input<typeof TemplateStageAddRequest>;

export const TemplateStageUpdateRequest = z
  .object({
    name: StageName.optional(),
    description: z.string().trim().max(500).nullish(),
    weight: Weight.optional(),
    dueRule: DueRule.nullish(),
    defaultTasks: TaskTitles.optional(),
    versionNo: VersionNo,
  })
  .strict();
export type TemplateStageUpdateRequest = z.infer<typeof TemplateStageUpdateRequest>;

export const TemplateMoveRequest = z
  .object({ beforeId: Uuid7.optional(), afterId: Uuid7.optional(), versionNo: VersionNo })
  .strict();
export type TemplateMoveRequest = z.infer<typeof TemplateMoveRequest>;

export const TemplateVersionRequest = z.object({ versionNo: VersionNo }).strict();
export type TemplateVersionRequest = z.infer<typeof TemplateVersionRequest>;

/** The review step's question: what dates would this template give this event (R100)? */
export const ResolveTemplateRequest = z.object({ eventId: Uuid7 }).strict();
export type ResolveTemplateRequest = z.infer<typeof ResolveTemplateRequest>;

export const ResolvedTemplate = z
  .object({
    templateId: Uuid7.nullable(),
    templateName: z.string().nullable(),
    stages: z.array(
      z
        .object({
          templateStageId: Uuid7,
          name: z.string().min(1),
          /** Null: "No date — set one". */
          dueAt: z.iso.datetime().nullable(),
          taskCount: z.int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type ResolvedTemplate = z.infer<typeof ResolvedTemplate>;
