import {
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_TRANSITIONS,
  PIPELINE_COLUMNS,
  type CompetitionListItem,
  type EngagementStatus,
} from '@compintel/contracts';

/**
 * The pipeline board's pure rules (WP-19 step 6): which card sits in which
 * column, where a card may go, which moves ask first, and which can be undone.
 * All of it reads R97's table in the contracts; nothing here is written twice.
 */

export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];

export function columnsOf(
  items: readonly CompetitionListItem[],
): { status: PipelineColumn; items: CompetitionListItem[] }[] {
  return PIPELINE_COLUMNS.map((status) => ({
    status,
    items: items.filter((item) => item.status === status),
  }));
}

/** Where this card may move — the board's columns and the two closing states. */
export function moveTargets(status: EngagementStatus): readonly EngagementStatus[] {
  return ENGAGEMENT_TRANSITIONS[status];
}

export function canDrop(from: EngagementStatus, to: EngagementStatus): boolean {
  return from !== to && ENGAGEMENT_TRANSITIONS[from].includes(to);
}

/** A move into a final state asks first: it cannot be taken back. */
export function needsConfirm(to: EngagementStatus): boolean {
  return ENGAGEMENT_TRANSITIONS[to].length === 0;
}

/** Undo is offered only where the reverse move is itself allowed: Considering ↔ Assigned. */
export function undoable(from: EngagementStatus, to: EngagementStatus): boolean {
  return canDrop(to, from);
}

/** What a move menu item says: "Move to Applied", "Withdraw", "Mark not selected". */
export function moveLabel(to: EngagementStatus): string {
  if (to === 'WITHDRAWN') return 'Withdraw';
  if (to === 'NOT_SELECTED') return 'Mark not selected';
  return `Move to ${ENGAGEMENT_STATUS_LABELS[to]}`;
}

/** What the live region says after a move. */
export function movedText(name: string, to: EngagementStatus): string {
  return `${name} moved to ${ENGAGEMENT_STATUS_LABELS[to]}.`;
}

/** The card's name: the team, or the student of an individual entry. */
export function whoOf(item: CompetitionListItem): string {
  return item.team?.name ?? item.student?.fullName ?? 'Individual entry';
}
