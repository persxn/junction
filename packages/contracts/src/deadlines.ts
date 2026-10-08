import { z } from 'zod';

import { DatePrecision } from './enums.js';
import { DeadlineKind } from './events.js';
import { Uuid7 } from './ids.js';

/**
 * The deadline read model (§12, §6.4, rulings R106–R107, WP-22): one view of
 * every date someone here cares about — saved or competing events' deadlines,
 * open stages and tasks — bucketed by urgency on Asia/Kolkata days. Each item
 * sits in exactly one bucket; the bucket is computed by the server at request
 * time and the UI only ticks the countdown. `DueItem` is WP-23's hand-over.
 */

/** §6.4's urgency bands, disjoint (R107). */
export const URGENCY_BUCKETS = ['OVERDUE', 'TODAY', 'DAYS_3', 'DAYS_7', 'LATER'] as const;
export const UrgencyBucket = z.enum(URGENCY_BUCKETS);
export type UrgencyBucket = z.infer<typeof UrgencyBucket>;

export const URGENCY_BUCKET_LABELS: Readonly<Record<UrgencyBucket, string>> = {
  OVERDUE: 'Overdue',
  TODAY: 'Today',
  DAYS_3: 'In the next 3 days',
  DAYS_7: 'In the next 7 days',
  LATER: 'Later',
};

export const DUE_ITEM_KINDS = ['EVENT_DEADLINE', 'STAGE', 'TASK'] as const;
export const DueItemKind = z.enum(DUE_ITEM_KINDS);
export type DueItemKind = z.infer<typeof DueItemKind>;

export const DUE_ITEM_KIND_LABELS: Readonly<Record<DueItemKind, string>> = {
  EVENT_DEADLINE: 'Event deadline',
  STAGE: 'Workflow stage',
  TASK: 'Task',
};

/** §12's split, kept as a filter: the event's own dates, or our work on it. */
export const DEADLINE_GROUPS = ['EVENTS', 'WORK'] as const;
export const DeadlineGroup = z.enum(DEADLINE_GROUPS);
export type DeadlineGroup = z.infer<typeof DeadlineGroup>;

export const DEADLINE_GROUP_LABELS: Readonly<Record<DeadlineGroup, string>> = {
  EVENTS: 'Event deadlines',
  WORK: 'Our work',
};

/** D-03's scopes. */
export const DEADLINE_SCOPES = ['MINE', 'TEAM', 'ALL'] as const;
export const DeadlineScope = z.enum(DEADLINE_SCOPES);
export type DeadlineScope = z.infer<typeof DeadlineScope>;

export const DEADLINE_SCOPE_LABELS: Readonly<Record<DeadlineScope, string>> = {
  MINE: 'Mine',
  TEAM: 'A team',
  ALL: 'Everyone',
};

export const DueItem = z
  .object({
    /** Stable across requests: `deadline:<id>`, `event-reg:<id>`, `stage:<id>`, `task:<id>`. */
    id: z.string().min(1),
    itemKind: DueItemKind,
    /** The event deadline's kind; null for stages and tasks. */
    deadlineKind: DeadlineKind.nullable(),
    label: z.string().min(1),
    dueAt: z.iso.datetime(),
    precision: DatePrecision,
    bucket: UrgencyBucket,
    /** Kolkata calendar days from today; negative when overdue. */
    daysLeft: z.int(),
    eventId: Uuid7,
    eventTitle: z.string().min(1),
    engagementId: Uuid7.nullable(),
    /** "Team Rocket — HackXYZ" for a competition's work. */
    competitionName: z.string().nullable(),
    teamId: Uuid7.nullable(),
    teamName: z.string().nullable(),
    stageId: Uuid7.nullable(),
    taskId: Uuid7.nullable(),
    /** "Stated by Devfolio" · "Entered manually" · "Workflow stage" · "Task". */
    sourceLabel: z.string().min(1),
  })
  .strict();
export type DueItem = z.infer<typeof DueItem>;

export const DeadlineQuery = z
  .object({
    scope: DeadlineScope.default('MINE'),
    teamId: Uuid7.optional(),
    group: DeadlineGroup.optional(),
    bucket: UrgencyBucket.optional(),
    itemKind: DueItemKind.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type DeadlineQuery = z.infer<typeof DeadlineQuery>;
export type DeadlineQueryInput = z.input<typeof DeadlineQuery>;

export const BucketCounts = z.object(
  Object.fromEntries(URGENCY_BUCKETS.map((bucket) => [bucket, z.int().min(0)])) as Record<
    UrgencyBucket,
    z.ZodInt
  >,
);
export type BucketCounts = z.infer<typeof BucketCounts>;

export const DeadlineListResponse = z
  .object({
    items: z.array(DueItem),
    /** Per bucket, for the query's other filters (ignoring `bucket`). */
    counts: BucketCounts,
    /** The total the list shows: the chosen bucket's count, or all of them. */
    total: z.int().min(0),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type DeadlineListResponse = z.infer<typeof DeadlineListResponse>;
