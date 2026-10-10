import { z } from 'zod';

import { EngagementStatus } from './engagement-status.js';
import { EventMode, EventType } from './enums.js';
import { Uuid7 } from './ids.js';
import { OutcomeResult } from './outcomes.js';
import { IsoDate } from './search.js';

/**
 * The Insights surface (WP-33, ruling R69): every number is a count over rows
 * the app already holds. Nothing is estimated, extrapolated or written by an
 * LLM, and rates travel as numerator and denominator so the screen can say
 * "3 of 5" instead of trusting a rounded float.
 *
 * Dates follow A7: `YYYY-MM-DD` in Asia/Kolkata, both bounds inclusive.
 * Months and weeks are Kolkata calendar months and Monday-start weeks.
 */

/** The longest range one request may ask for: five years. */
export const INSIGHTS_MAX_RANGE_DAYS = 1_830;

export const InsightsQuery = z
  .object({ from: IsoDate.optional(), to: IsoDate.optional() })
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
export type InsightsQuery = z.infer<typeof InsightsQuery>;

/** A count out of a total — a rate without a rounded number in it. */
export const Fraction = z.object({ numerator: z.int().min(0), denominator: z.int().min(0) });
export type Fraction = z.infer<typeof Fraction>;

export const MonthPoint = z.object({
  /** `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Competitions that entered ASSIGNED for the first time in this month. */
  assigned: z.int().min(0),
  /** Competitions in an active status (ASSIGNED/APPLIED/PARTICIPATING) at any time in it. */
  active: z.int().min(0),
});
export type MonthPoint = z.infer<typeof MonthPoint>;

export const FUNNEL_STAGES = [
  'CONSIDERING',
  'ASSIGNED',
  'APPLIED',
  'PARTICIPATING',
  'COMPLETED',
] as const satisfies readonly EngagementStatus[];

export const FunnelStep = z.object({
  status: EngagementStatus,
  /** Competitions created in the range that ever reached this status or a later one. */
  reached: z.int().min(0),
});

export const Funnel = z.object({
  steps: z.array(FunnelStep),
  /** Every competition created in the range, withdrawn and unselected included. */
  total: z.int().min(0),
  withdrawn: z.int().min(0),
  notSelected: z.int().min(0),
  /** COMPLETED over every competition that was not withdrawn. */
  completion: Fraction,
});
export type Funnel = z.infer<typeof Funnel>;

export const NamedCount = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  count: z.int().min(0),
});
export type NamedCount = z.infer<typeof NamedCount>;

export const MentorLoad = z.object({
  userId: Uuid7,
  name: z.string().min(1),
  /** Competitions they mentor now that are in an active status. */
  active: z.int().min(0),
  /** Competitions in the range they mentor or mentored. */
  total: z.int().min(0),
});
export type MentorLoad = z.infer<typeof MentorLoad>;

export const DeadlineHit = z.object({
  /** Stages due in the range and already past due, completed on or before the due time. */
  met: z.int().min(0),
  /** Stages due in the range and past due, completed late or not at all. */
  missed: z.int().min(0),
  /** Stages in the range's competitions with no due date: neither met nor missed. */
  undated: z.int().min(0),
});
export type DeadlineHit = z.infer<typeof DeadlineHit>;

export const SourceContribution = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  /** Events this source reported that were first seen in the range. */
  events: z.int().min(0),
  /** Of the events behind the range's competitions, how many this source reported. */
  assigned: z.int().min(0),
});
export type SourceContribution = z.infer<typeof SourceContribution>;

export const Streaks = z.object({
  /** Monday-start weeks in the range with at least one active competition. */
  activeWeeks: z.int().min(0),
  weeksInRange: z.int().min(0),
  longest: z.int().min(0),
  /** Consecutive active weeks ending with the range's last week (0 if that week was quiet). */
  current: z.int().min(0),
});
export type Streaks = z.infer<typeof Streaks>;

export const MILESTONE_KINDS = ['FIRST_WINNER', 'TENTH_COMPLETED', 'FOUR_WEEK_STREAK'] as const;
export const MilestoneKind = z.enum(MILESTONE_KINDS);
export type MilestoneKind = z.infer<typeof MilestoneKind>;

/** A recorded fact worth one dismissible acknowledgement (R69). All-time, not ranged. */
export const Milestone = z.object({
  kind: MilestoneKind,
  /** Stable, so a dismissed milestone is never shown again. */
  id: z.string().min(1),
  /** When the fact became true, ISO instant. */
  at: z.iso.datetime(),
  title: z.string().min(1),
});
export type Milestone = z.infer<typeof Milestone>;

export const InsightsResponse = z.object({
  from: IsoDate,
  to: IsoDate,
  /** True when the department has never had a competition: show the empty state. */
  isEmpty: z.boolean(),
  /** Competitions active right now — the Competitions screen's own active total. */
  activeNow: z.int().min(0),
  participation: z.array(MonthPoint),
  eventsByType: z.array(z.object({ type: EventType, count: z.int().min(0) })),
  eventsByMode: z.array(z.object({ mode: EventMode, count: z.int().min(0) })),
  funnel: Funnel,
  outcomes: z.array(z.object({ result: OutcomeResult, count: z.int().min(0) })),
  students: z.object({ distinct: z.int().min(0), top: z.array(NamedCount) }),
  teams: z.object({ distinct: z.int().min(0), top: z.array(NamedCount) }),
  mentors: z.array(MentorLoad),
  deadlines: DeadlineHit,
  sources: z.array(SourceContribution),
  streaks: Streaks,
  milestones: z.array(Milestone),
});
export type InsightsResponse = z.infer<typeof InsightsResponse>;
