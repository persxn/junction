import type { DueItem } from '@compintel/contracts';

/**
 * R109's recipients and the collapse of watched-event changes, over plain
 * inputs (WP-23). Students are not users and never appear here.
 */

export interface RecipientFacts {
  /** Active PRIMARY + CO_MENTOR user ids per competition, valid at `now`. */
  readonly mentorsOf: (engagementId: string) => readonly string[];
  /** Users who saved the event. */
  readonly saversOf: (eventId: string) => readonly string[];
  /** Active mentors of the event's active competitions. */
  readonly competitionMentorsOfEvent: (eventId: string) => readonly string[];
}

/** Who a due item's notification goes to (R109). */
export function recipientsFor(
  item: Pick<DueItem, 'itemKind' | 'engagementId' | 'eventId'>,
  facts: RecipientFacts,
): string[] {
  if (item.itemKind !== 'EVENT_DEADLINE') {
    return item.engagementId === null ? [] : [...new Set(facts.mentorsOf(item.engagementId))];
  }
  return [
    ...new Set([...facts.saversOf(item.eventId), ...facts.competitionMentorsOfEvent(item.eventId)]),
  ];
}

export interface EventChange {
  /** UUIDv7 — monotonic, so the newest is the largest. */
  readonly id: string;
  readonly eventId: string;
  readonly field: 'registrationDeadlineAt' | 'submissionDeadlineAt' | 'cancellation';
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly changedBy: string | null;
}

export interface CollapsedChange {
  readonly eventId: string;
  /** The newest change's id — the dedupe anchor. */
  readonly changeId: string;
  readonly kind: 'CANCELLED' | 'MOVED';
  /** For MOVED: did a deadline come earlier? */
  readonly earlier: boolean;
  /** Who made any of these changes: never told (R109). */
  readonly changers: ReadonlySet<string>;
}

/** A deadline value as stored: Unix ms, an ISO string, or `{ at }` (WP-10's claims). */
const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && 'at' in value) return asNumber(value.at);
  return null;
};

/** All changes of one event in one run → one notification, keyed on the newest change. */
export function collapseChanges(changes: readonly EventChange[]): CollapsedChange[] {
  const byEvent = new Map<string, EventChange[]>();
  for (const change of changes)
    byEvent.set(change.eventId, [...(byEvent.get(change.eventId) ?? []), change]);
  const out: CollapsedChange[] = [];
  for (const [eventId, list] of byEvent) {
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    const newest = sorted.at(-1)!;
    const cancelled = sorted.some(
      (change) =>
        change.field === 'cancellation' && change.newValue !== 'NONE' && change.newValue !== null,
    );
    const moves = sorted.filter((change) => change.field !== 'cancellation');
    if (!cancelled && moves.length === 0) continue;
    const first = moves[0];
    const last = moves.at(-1);
    const before = first === undefined ? null : asNumber(first.oldValue);
    const after = last === undefined ? null : asNumber(last.newValue);
    out.push({
      eventId,
      changeId: newest.id,
      kind: cancelled ? 'CANCELLED' : 'MOVED',
      earlier: before !== null && after !== null && after < before,
      changers: new Set(
        sorted.flatMap((change) => (change.changedBy === null ? [] : [change.changedBy])),
      ),
    });
  }
  return out;
}

/** Watchers of an event, minus whoever changed it (R109). */
export function changeRecipients(change: CollapsedChange, facts: RecipientFacts): string[] {
  return [
    ...new Set([
      ...facts.saversOf(change.eventId),
      ...facts.competitionMentorsOfEvent(change.eventId),
    ]),
  ].filter((user) => !change.changers.has(user));
}
