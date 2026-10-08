import type {
  DatePrecision,
  DeadlineKind,
  DueItem,
  DueItemKind,
  UrgencyBucket,
} from '@compintel/contracts';

import { formatDay, zonedDayBounds } from '../../platform/time.js';
import { addDays } from '../workflows/due.js';
import { calendarDays } from '../workflows/health.js';

/**
 * The deadline read model's arithmetic (§12, §6.4, R106–R107, ADR-0015, WP-22),
 * pure and `Clock`-free: where today and the next 3 and 7 Kolkata days end,
 * which band a due instant falls in, and the rows of `v_deadlines` turned into
 * `DueItem`s. WP-23 adds thresholds, recipients and dedupe on top of
 * `dueItems` and never re-derives a bucket.
 */

/** Buckets are cut on these calendar days (A7). */
export const BUCKET_ZONE = 'Asia/Kolkata';

/** The exclusive ends of TODAY, ≤ 3 DAYS and ≤ 7 DAYS; anything before `now` is OVERDUE. */
export interface BucketBounds {
  readonly now: number;
  readonly endOfToday: number;
  readonly endOfDay3: number;
  readonly endOfDay7: number;
}

export function bucketBounds(now: number, zone: string = BUCKET_ZONE): BucketBounds {
  const today = formatDay(zone, new Date(now));
  const end = (days: number): number =>
    zonedDayBounds(zone, addDays(today, days)).endUtcExclusive.getTime();
  return { now, endOfToday: end(0), endOfDay3: end(3), endOfDay7: end(7) };
}

export function urgencyOf(dueAt: number, bounds: BucketBounds): UrgencyBucket {
  if (dueAt < bounds.now) return 'OVERDUE';
  if (dueAt < bounds.endOfToday) return 'TODAY';
  if (dueAt < bounds.endOfDay3) return 'DAYS_3';
  if (dueAt < bounds.endOfDay7) return 'DAYS_7';
  return 'LATER';
}

/** One `v_deadlines` row, as the repository reads it. */
export interface DeadlineRow {
  readonly id: string;
  readonly itemKind: DueItemKind;
  readonly deadlineKind: DeadlineKind | null;
  readonly label: string;
  readonly dueAt: number;
  readonly precision: DatePrecision;
  readonly eventId: string;
  readonly eventTitle: string;
  /** The event's IANA zone; null → the display zone. */
  readonly eventTimezone: string | null;
  readonly engagementId: string | null;
  readonly competitionName: string | null;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly stageId: string | null;
  readonly taskId: string | null;
  /** SOURCE · MANUAL for an event's date; STAGE · TASK for our work. */
  readonly origin: 'SOURCE' | 'MANUAL' | 'STAGE' | 'TASK';
  /** The source that stated it ("Devfolio"), when known. */
  readonly sourceName: string | null;
}

/**
 * When a row is really due (ADR-0015): a DATE is the end of that day in the
 * event's zone, a MONTH the end of that month; an UNKNOWN date has no instant
 * to bucket and is left out.
 */
export function effectiveDueAt(
  row: Pick<DeadlineRow, 'dueAt' | 'precision' | 'eventTimezone'>,
): number | null {
  const zone = row.eventTimezone ?? BUCKET_ZONE;
  if (row.precision === 'DATETIME') return row.dueAt;
  if (row.precision === 'UNKNOWN') return null;
  const day = formatDay(zone, new Date(row.dueAt));
  if (row.precision === 'DATE') return zonedDayBounds(zone, day).endUtcExclusive.getTime() - 1;
  const [year, month] = day.split('-').map(Number) as [number, number];
  const nextMonth =
    month === 12
      ? `${String(year + 1)}-01-01`
      : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`;
  return zonedDayBounds(zone, nextMonth).startUtc.getTime() - 1;
}

export function sourceLabelOf(row: Pick<DeadlineRow, 'origin' | 'sourceName'>): string {
  switch (row.origin) {
    case 'MANUAL':
      return 'Entered manually';
    case 'STAGE':
      return 'Workflow stage';
    case 'TASK':
      return 'Task';
    case 'SOURCE':
      return row.sourceName === null ? 'Stated by the source' : `Stated by ${row.sourceName}`;
  }
}

/** R106: an event's date that has passed leaves the model; our own work becomes OVERDUE. */
export function isLive(row: Pick<DeadlineRow, 'itemKind'>, dueAt: number, now: number): boolean {
  return row.itemKind !== 'EVENT_DEADLINE' || dueAt >= now;
}

/** The hand-over to WP-23: rows → items with their bucket, in due order. */
export function dueItems(rows: readonly DeadlineRow[], now: number): DueItem[] {
  const bounds = bucketBounds(now);
  const items: DueItem[] = [];
  for (const row of rows) {
    const at = effectiveDueAt(row);
    if (at === null || !isLive(row, at, now)) continue;
    items.push({
      id: row.id,
      itemKind: row.itemKind,
      deadlineKind: row.deadlineKind,
      label: row.label,
      dueAt: new Date(at).toISOString(),
      precision: row.precision,
      bucket: urgencyOf(at, bounds),
      daysLeft: calendarDays(now, at, BUCKET_ZONE),
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      engagementId: row.engagementId,
      competitionName: row.competitionName,
      teamId: row.teamId,
      teamName: row.teamName,
      stageId: row.stageId,
      taskId: row.taskId,
      sourceLabel: sourceLabelOf(row),
    });
  }
  return items.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}
