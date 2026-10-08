import { z } from 'zod';

import { Uuid7 } from './ids.js';

/**
 * A competition's status and kind (R97), apart from the rest of
 * `engagements.ts` so the team and student contracts can name a competition
 * without importing the module that imports them.
 */

export const ENGAGEMENT_STATUSES = [
  'CONSIDERING',
  'ASSIGNED',
  'APPLIED',
  'PARTICIPATING',
  'COMPLETED',
  'WITHDRAWN',
  'NOT_SELECTED',
] as const;
export const EngagementStatus = z.enum(ENGAGEMENT_STATUSES);
export type EngagementStatus = z.infer<typeof EngagementStatus>;

export const ENGAGEMENT_STATUS_LABELS: Readonly<Record<EngagementStatus, string>> = {
  CONSIDERING: 'Considering',
  ASSIGNED: 'Assigned',
  APPLIED: 'Applied',
  PARTICIPATING: 'Participating',
  COMPLETED: 'Completed',
  WITHDRAWN: 'Withdrawn',
  NOT_SELECTED: 'Not selected',
};

export const PARTICIPANT_KINDS = ['TEAM', 'INDIVIDUAL'] as const;
export const ParticipantKind = z.enum(PARTICIPANT_KINDS);
export type ParticipantKind = z.infer<typeof ParticipantKind>;

/** A competition as the Team and Student pages list it. */
export const CompetitionRef = z
  .object({
    id: Uuid7,
    eventTitle: z.string().min(1),
    status: EngagementStatus,
    kind: ParticipantKind,
    teamName: z.string().nullable(),
    /** On the Student page: whether the student is still on its roster. */
    onRoster: z.boolean(),
  })
  .strict();
export type CompetitionRef = z.infer<typeof CompetitionRef>;
