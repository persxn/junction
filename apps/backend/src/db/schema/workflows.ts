import {
  DUE_ORIGINS,
  EVENT_TYPES,
  STAGE_STATUSES,
  STAGE_WEIGHT_MAX,
  type DueOrigin,
  type EventType,
  type StageStatus,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { engagements } from './engagements.js';
import { users } from './identity.js';
import { departments } from './organization.js';
import { students } from './students.js';

/**
 * §6.2 "Workflows" (rulings R99–R101, roadmap WP-20a), without `resources`
 * (WP-20b). A template is copied into a competition when it becomes ASSIGNED;
 * later template edits never reach an existing workflow. Positions are REAL so
 * a reorder writes one row (R101). Deleting a workflow takes its stages, and a
 * stage its tasks and assignees, with it.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

const weightCheck = `"weight" between 0 and ${String(STAGE_WEIGHT_MAX)}`;

export const workflowTemplates = sqliteTable(
  'workflow_templates',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id),
    name: text('name').notNull(),
    description: text('description'),
    appliesToEventType: text('applies_to_event_type').$type<EventType>(),
    isDefaultForType: integer('is_default_for_type', { mode: 'boolean' }).notNull().default(false),
    /** Edit count and optimistic-concurrency version (R101). */
    versionNo: integer('version_no').notNull().default(1),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    /** Null for the seeded department defaults. */
    createdBy: text('created_by').references(() => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    // One preselected template per event type and department.
    uniqueIndex('workflow_templates_default_uq')
      .on(table.departmentId, table.appliesToEventType)
      .where(sql`"is_default_for_type" = 1 and "is_archived" = 0`),
    check(
      'workflow_templates_type_check',
      sql.raw(`"applies_to_event_type" is null or ${inList('applies_to_event_type', EVENT_TYPES)}`),
    ),
    check('workflow_templates_version_check', sql.raw(`"version_no" >= 1`)),
  ],
);

export const workflowTemplateStages = sqliteTable(
  'workflow_template_stages',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    weight: integer('weight').notNull().default(1),
    dueRuleJson: text('due_rule_json'),
    defaultTasksJson: text('default_tasks_json').notNull().default('[]'),
  },
  (table) => [
    index('workflow_template_stages_position_idx').on(table.templateId, table.position),
    check('workflow_template_stages_weight_check', sql.raw(weightCheck)),
  ],
);

export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id),
    templateId: text('template_id').references(() => workflowTemplates.id),
    templateVersionNo: integer('template_version_no'),
    createdAt: integer('created_at').notNull(),
    /** Structure version: adding, removing and reordering stages bump it (WP-20a). */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('workflows_engagement_uq').on(table.engagementId),
    check('workflows_version_check', sql.raw(`"version" >= 1`)),
  ],
);

export const workflowStages = sqliteTable(
  'workflow_stages',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    weight: integer('weight').notNull().default(1),
    status: text('status').$type<StageStatus>().notNull().default('NOT_STARTED'),
    blockedReason: text('blocked_reason'),
    dueAt: integer('due_at'),
    dueRuleJson: text('due_rule_json'),
    dueOrigin: text('due_origin').$type<DueOrigin>().notNull().default('NONE'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    completedBy: text('completed_by').references(() => users.id),
    progressOverride: integer('progress_override'),
    completedWithOpenTasks: integer('completed_with_open_tasks', { mode: 'boolean' })
      .notNull()
      .default(false),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('workflow_stages_position_idx').on(table.workflowId, table.position),
    check('workflow_stages_status_check', sql.raw(inList('status', STAGE_STATUSES))),
    check('workflow_stages_origin_check', sql.raw(inList('due_origin', DUE_ORIGINS))),
    check('workflow_stages_weight_check', sql.raw(weightCheck)),
    check(
      'workflow_stages_override_check',
      sql.raw(`"progress_override" is null or "progress_override" between 0 and 100`),
    ),
    check(
      'workflow_stages_blocked_check',
      sql.raw(`"status" <> 'BLOCKED' or "blocked_reason" is not null`),
    ),
    check('workflow_stages_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type WorkflowStageRow = typeof workflowStages.$inferSelect;

export const stageAssignees = sqliteTable(
  'stage_assignees',
  {
    stageId: text('stage_id')
      .notNull()
      .references(() => workflowStages.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
  },
  (table) => [primaryKey({ columns: [table.stageId, table.studentId] })],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    stageId: text('stage_id')
      .notNull()
      .references(() => workflowStages.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    title: text('title').notNull(),
    isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
    doneAt: integer('done_at'),
    doneBy: text('done_by').references(() => users.id),
    assigneeStudentId: text('assignee_student_id').references(() => students.id),
    dueAt: integer('due_at'),
    notes: text('notes'),
  },
  (table) => [index('tasks_position_idx').on(table.stageId, table.position)],
);
