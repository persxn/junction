import { ENGAGEMENT_STATUS_LABELS, type EngagementStatus } from '@compintel/contracts';

import { allowedFrom, transitionRefusal } from '../../domain/engagements/status.js';
import { AppError } from '../../platform/errors.js';

/**
 * The `ENGAGEMENT_` problems (R12, WP-19). The code says "engagement"; every
 * word a person reads says "competition".
 */

export interface Named {
  readonly id: string;
  readonly name: string;
}

export const competitionNotFound = (): AppError =>
  new AppError({
    code: 'ENGAGEMENT_NOT_FOUND',
    status: 404,
    title: 'No such competition',
    detail: 'That competition does not exist.',
    retryable: false,
  });

export const competitionVersionConflict = (): AppError =>
  new AppError({
    code: 'ENGAGEMENT_VERSION_CONFLICT',
    status: 409,
    title: 'Someone else changed this competition',
    detail: 'Someone else changed this competition — reload to see their changes.',
    hint: 'Reload the competition, then make your change again.',
    retryable: false,
  });

export const invalidTransition = (from: EngagementStatus, to: EngagementStatus): AppError =>
  new AppError({
    code: 'ENGAGEMENT_INVALID_TRANSITION',
    status: 409,
    title: 'That move is not allowed',
    detail: transitionRefusal(from, to),
    allowed: allowedFrom(from),
    retryable: false,
  });

export const competitionClosed = (status: EngagementStatus): AppError =>
  new AppError({
    code: 'ENGAGEMENT_CLOSED',
    status: 409,
    title: 'This competition is closed',
    detail: `A competition that is ${ENGAGEMENT_STATUS_LABELS[status]} can no longer be changed.`,
    retryable: false,
  });

/** A14: "already in Team Rocket — HackXYZ 2026 for this event". */
export const studentAlreadyActive = (who: string, other: Named): AppError =>
  new AppError({
    code: 'ENGAGEMENT_STUDENT_ALREADY_ACTIVE',
    status: 409,
    title: 'Already taking part in this event',
    detail: `${who} is already in ${other.name} for this event.`,
    hint: 'Withdraw them from the other competition first, or leave them out.',
    related: [other],
    retryable: false,
  });

export const teamAlreadyAssigned = (other: Named): AppError =>
  new AppError({
    code: 'ENGAGEMENT_TEAM_ALREADY_ASSIGNED',
    status: 409,
    title: 'This team already has this event',
    detail: `This team is already taking part: ${other.name}.`,
    related: [other],
    retryable: false,
  });

export const eventMerged = (survivor: Named): AppError =>
  new AppError({
    code: 'ENGAGEMENT_EVENT_MERGED',
    status: 409,
    title: 'This event was merged into another',
    detail: `This event is now part of “${survivor.name}”. Assign that one instead.`,
    related: [survivor],
    retryable: false,
  });

export const emptyRoster = (): AppError =>
  new AppError({
    code: 'ENGAGEMENT_EMPTY_ROSTER',
    status: 422,
    title: 'Nobody to take part',
    detail: 'None of this team’s members is an active student, so the competition would be empty.',
    hint: 'Add an active student to the team first.',
    retryable: false,
  });

export const competitionMentorExists = (): AppError =>
  new AppError({
    code: 'ENGAGEMENT_MENTOR_EXISTS',
    status: 409,
    title: 'Already a mentor',
    detail: 'That professor already mentors this competition.',
    retryable: false,
  });

export const competitionMentorNotFound = (): AppError =>
  new AppError({
    code: 'ENGAGEMENT_MENTOR_NOT_FOUND',
    status: 404,
    title: 'No such co-mentor',
    detail:
      'That co-mentor is not mentoring this competition. The primary mentor is handed over, not ended.',
    retryable: false,
  });

export const participantNotFound = (): AppError =>
  new AppError({
    code: 'ENGAGEMENT_PARTICIPANT_NOT_FOUND',
    status: 404,
    title: 'Not on the roster',
    detail: 'That student is not on this competition’s roster.',
    retryable: false,
  });

export const teamHasActiveCompetitions = (open: readonly Named[]): AppError =>
  new AppError({
    code: 'TEAM_HAS_ACTIVE_COMPETITIONS',
    status: 409,
    title: 'This team still has open competitions',
    detail: `Finish or withdraw these first: ${open.map((item) => item.name).join('; ')}.`,
    related: open,
    retryable: false,
  });
