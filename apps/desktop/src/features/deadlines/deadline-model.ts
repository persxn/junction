import {
  DEADLINE_GROUPS,
  DEADLINE_SCOPES,
  DUE_ITEM_KINDS,
  URGENCY_BUCKETS,
  type DeadlineGroup,
  type DeadlineQueryInput,
  type DeadlineScope,
  type DueItem,
  type DueItemKind,
  type UrgencyBucket,
} from '@compintel/contracts';

import { DISPLAY_ZONE } from '../discover/format.js';

/**
 * The Deadline Radar's words and router state (WP-22, R106–R107, ADR-0015):
 * the urgency in words from the server's bucket (the UI never recomputes the
 * bucket, it only counts days for the words), dates with their precision kept
 * — "27 Sep (time not stated)", never "00:00" — and the filters a link carries.
 */

export interface DeadlinesSearch {
  readonly scope: DeadlineScope;
  readonly teamId: string | undefined;
  readonly group: DeadlineGroup | undefined;
  readonly bucket: UrgencyBucket | undefined;
  readonly itemKind: DueItemKind | undefined;
}

export const DEFAULT_DEADLINES_SEARCH: DeadlinesSearch = {
  scope: 'MINE',
  teamId: undefined,
  group: undefined,
  bucket: undefined,
  itemKind: undefined,
};

const pick = <T extends string>(raw: unknown, allowed: readonly T[]): T | undefined =>
  (allowed as readonly unknown[]).includes(raw) ? (raw as T) : undefined;

export function parseDeadlinesSearch(raw: Record<string, unknown>): DeadlinesSearch {
  return {
    scope: pick(raw.scope, DEADLINE_SCOPES) ?? 'MINE',
    teamId: typeof raw.teamId === 'string' && raw.teamId !== '' ? raw.teamId : undefined,
    group: pick(raw.group, DEADLINE_GROUPS),
    bucket: pick(raw.bucket, URGENCY_BUCKETS),
    itemKind: pick(raw.itemKind, DUE_ITEM_KINDS),
  };
}

export function toDeadlineQuery(search: DeadlinesSearch): DeadlineQueryInput {
  return {
    scope: search.scope === 'TEAM' && search.teamId === undefined ? 'MINE' : search.scope,
    ...(search.scope === 'TEAM' && search.teamId !== undefined ? { teamId: search.teamId } : {}),
    ...(search.group === undefined ? {} : { group: search.group }),
    ...(search.bucket === undefined ? {} : { bucket: search.bucket }),
    ...(search.itemKind === undefined ? {} : { itemKind: search.itemKind }),
  };
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_ZONE,
  day: 'numeric',
  month: 'short',
});
const MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_ZONE, month: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dayMonth = (at: Date): string => DAY_MONTH.format(at).replace('Sept', 'Sep');

/** The date as honestly as it is known: "9 Oct, 17:30", "27 Sep (time not stated)", "Oct (date not stated)". */
export function dateText(item: Pick<DueItem, 'dueAt' | 'precision'>): string {
  const at = new Date(item.dueAt);
  if (item.precision === 'MONTH')
    return `${MONTH.format(at).replace('Sept', 'Sep')} (date not stated)`;
  if (item.precision === 'DATE') return `${dayMonth(at)} (time not stated)`;
  return `${dayMonth(at)}, ${TIME.format(at)}`;
}

/** Whole Kolkata calendar days from `now` to the item — for the words only. */
export function daysUntil(dueAt: string, now: number): number {
  const day = (instant: number): number => Date.parse(`${KEY.format(new Date(instant))}T00:00:00Z`);
  return Math.round((day(Date.parse(dueAt)) - day(now)) / 86_400_000);
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** "Overdue by 2 days", "Due today", "Tomorrow", "In 3 days", "Later — 14 Oct". */
export function urgencyText(item: Pick<DueItem, 'bucket' | 'dueAt'>, now: number): string {
  const days = daysUntil(item.dueAt, now);
  switch (item.bucket) {
    case 'OVERDUE':
      return days >= 0 ? 'Overdue since earlier today' : `Overdue by ${plural(-days, 'day')}`;
    case 'TODAY':
      return 'Due today';
    case 'DAYS_3':
    case 'DAYS_7':
      return days <= 1 ? 'Tomorrow' : `In ${plural(days, 'day')}`;
    case 'LATER':
      return `Later — ${dayMonth(new Date(item.dueAt))}`;
  }
}
