import { z } from 'zod';

import { EngagementStatus } from './engagement-status.js';
import { DatePrecision } from './enums.js';
import { Uuid7 } from './ids.js';
import { OutcomeResult } from './outcomes.js';
import { StudentAchievement } from './students.js';

/**
 * A student's history (§16.2 "Student", ruling R104, WP-21): competitions with
 * their outcome as the student may see it, team memberships, and achievements
 * from before the app — each newest first, read from the existing tables.
 */

/** R104: the result is the team's; shown only to those on the roster when it was recorded. */
export const HISTORY_OUTCOME_STATES = ['SHOWN', 'LEFT_BEFORE_RESULT', 'NONE'] as const;
export const HistoryOutcomeState = z.enum(HISTORY_OUTCOME_STATES);
export type HistoryOutcomeState = z.infer<typeof HistoryOutcomeState>;

export const HistoryOutcome = z
  .object({
    result: OutcomeResult,
    rank: z.int().min(1).nullable(),
    prizeText: z.string().nullable(),
    prizeMinor: z.int().min(0).nullable(),
    prizeCurrency: z.string().nullable(),
  })
  .strict();
export type HistoryOutcome = z.infer<typeof HistoryOutcome>;

export const HistoryCompetition = z
  .object({
    competitionId: Uuid7,
    eventTitle: z.string().min(1),
    startsAt: z.int().nullable(),
    endsAt: z.int().nullable(),
    datePrecision: DatePrecision,
    /** Null for an individual entry ("Individual"). */
    teamName: z.string().nullable(),
    status: EngagementStatus,
    outcomeState: HistoryOutcomeState,
    /** Present only when `outcomeState` is SHOWN. */
    outcome: HistoryOutcome.nullable(),
    addedAt: z.iso.datetime(),
    removedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type HistoryCompetition = z.infer<typeof HistoryCompetition>;

export const HistoryTeam = z
  .object({
    teamId: Uuid7,
    teamName: z.string().min(1),
    joinedAt: z.iso.datetime(),
    leftAt: z.iso.datetime().nullable(),
    isLead: z.boolean(),
    roleLabel: z.string().nullable(),
  })
  .strict();
export type HistoryTeam = z.infer<typeof HistoryTeam>;

export const StudentHistory = z
  .object({
    studentId: Uuid7,
    erased: z.boolean(),
    competitions: z.array(HistoryCompetition),
    teams: z.array(HistoryTeam),
    /** None for an erased student (R92). */
    achievements: z.array(StudentAchievement),
  })
  .strict();
export type StudentHistory = z.infer<typeof StudentHistory>;
