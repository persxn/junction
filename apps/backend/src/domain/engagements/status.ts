import {
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TRANSITIONS,
  type EngagementStatus,
} from '@compintel/contracts';

/**
 * R97's status machine, read from the contracts table — the one place the
 * moves are written down. Pure: no clock, no database.
 */

export function allowedFrom(from: EngagementStatus): readonly EngagementStatus[] {
  return ENGAGEMENT_TRANSITIONS[from];
}

export function canTransition(from: EngagementStatus, to: EngagementStatus): boolean {
  return allowedFrom(from).includes(to);
}

/** COMPLETED, WITHDRAWN and NOT_SELECTED: nothing leaves them, nothing edits them. */
export function isTerminal(status: EngagementStatus): boolean {
  return allowedFrom(status).length === 0;
}

/** R97: entering these releases the roster for another competition on the event. */
export function closesRoster(status: EngagementStatus): boolean {
  return status === 'WITHDRAWN' || status === 'NOT_SELECTED';
}

/** Every status that still counts as taken on (§6.2's "active"). */
export const OPEN_STATUSES: readonly EngagementStatus[] = ENGAGEMENT_STATUSES.filter(
  (status) => !closesRoster(status),
);

const words = (statuses: readonly EngagementStatus[]): string => {
  const labels = statuses.map((status) => ENGAGEMENT_STATUS_LABELS[status]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1) ?? ''}`;
};

/**
 * The refusal in words (WP-19 step 4): "Can't move from Considering to
 * Applied. From Considering: Assigned or Withdrawn."
 */
export function transitionRefusal(from: EngagementStatus, to: EngagementStatus): string {
  const head = `Can't move from ${ENGAGEMENT_STATUS_LABELS[from]} to ${ENGAGEMENT_STATUS_LABELS[to]}.`;
  const allowed = allowedFrom(from);
  return allowed.length === 0
    ? `${head} ${ENGAGEMENT_STATUS_LABELS[from]} is final.`
    : `${head} From ${ENGAGEMENT_STATUS_LABELS[from]}: ${words(allowed)}.`;
}
