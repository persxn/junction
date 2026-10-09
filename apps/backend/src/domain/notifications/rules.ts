import type { DueItem, NotificationType, Severity, Thresholds } from '@compintel/contracts';

/**
 * The notification rules (§12, Q4, rulings R108–R111, WP-23), pure and
 * `now`-injected: which threshold a due item has crossed — read from WP-22's
 * bucket and calendar days, never re-derived — which one fires, the dedupe key,
 * the severity, and when a snoozed row comes back.
 */

/** Most urgent first. */
export type Threshold = 'OVERDUE' | 'DUE_DAY' | `D${number}`;

export const urgencyRank = (threshold: Threshold): number =>
  threshold === 'OVERDUE' ? -2 : threshold === 'DUE_DAY' ? -1 : Number(threshold.slice(1));

/** Every threshold this item has crossed, most urgent first (R108). */
export function crossedThresholds(
  item: Pick<DueItem, 'bucket' | 'daysLeft' | 'itemKind'>,
  thresholds: Thresholds,
): Threshold[] {
  const crossed: Threshold[] = [];
  // R109: an event's own date is never overdue — only our work is (R106).
  if (item.bucket === 'OVERDUE' && thresholds.overdue && item.itemKind !== 'EVENT_DEADLINE') {
    crossed.push('OVERDUE');
  }
  if (thresholds.dueDay && (item.bucket === 'TODAY' || item.bucket === 'OVERDUE')) {
    crossed.push('DUE_DAY');
  }
  for (const days of [...thresholds.days].sort((a, b) => a - b)) {
    if (item.daysLeft <= days) crossed.push(`D${String(days)}` as Threshold);
  }
  return crossed.sort((a, b) => urgencyRank(a) - urgencyRank(b));
}

/**
 * R108: at most one per (recipient, subject, due time) per run — the most
 * urgent crossed — and only if it has not fired; a less urgent one skipped by a
 * catch-up never fires later.
 */
export function pickMostUrgent(
  crossed: readonly Threshold[],
  fired: ReadonlySet<Threshold>,
): Threshold | undefined {
  const most = crossed[0];
  return most === undefined || fired.has(most) ? undefined : most;
}

/** `type:subjectKind:subjectId:threshold:dueAt` (R108). */
export function dedupeKey(parts: {
  readonly type: NotificationType;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly threshold: string;
  readonly dueAt: string;
}): string {
  return [parts.type, parts.subjectKind, parts.subjectId, parts.threshold, parts.dueAt].join(':');
}

/** The type a due item's threshold raises. */
export function typeForItem(
  item: Pick<DueItem, 'itemKind' | 'deadlineKind'>,
  threshold: Threshold,
): NotificationType {
  if (threshold === 'OVERDUE') return 'OVERDUE';
  if (item.itemKind === 'STAGE') return 'STAGE_DUE';
  if (item.itemKind === 'TASK') return 'TASK_DUE';
  return item.deadlineKind === 'REGISTRATION' ? 'REG_DEADLINE' : 'SUBMISSION_DEADLINE';
}

export type SeverityInput =
  | { readonly kind: 'THRESHOLD'; readonly threshold: Threshold }
  | { readonly kind: 'MOVED'; readonly earlier: boolean }
  | { readonly kind: 'CANCELLED'; readonly hasActiveCompetition: boolean }
  | { readonly kind: 'TYPE'; readonly type: NotificationType };

/** R110. */
export function severityOf(input: SeverityInput): Severity {
  switch (input.kind) {
    case 'THRESHOLD':
      if (input.threshold === 'OVERDUE' || input.threshold === 'DUE_DAY') return 'CRITICAL';
      return urgencyRank(input.threshold) <= 1 ? 'WARNING' : 'INFO';
    case 'MOVED':
      return input.earlier ? 'WARNING' : 'INFO';
    case 'CANCELLED':
      return input.hasActiveCompetition ? 'CRITICAL' : 'WARNING';
    case 'TYPE':
      if (input.type === 'BACKUP_FAILED') return 'CRITICAL';
      if (
        input.type === 'SOURCE_BLOCKED' ||
        input.type === 'CREDENTIAL_EXPIRED' ||
        input.type === 'SCRAPER_FAILING'
      ) {
        return 'WARNING';
      }
      return 'INFO';
  }
}

/** R111: snoozed rows whose time has come, not dismissed. */
export function resurfaceable<
  T extends { snoozedUntil: number | null; dismissedAt: number | null },
>(rows: readonly T[], now: number): T[] {
  return rows.filter(
    (row) => row.snoozedUntil !== null && row.snoozedUntil <= now && row.dismissedAt === null,
  );
}

/** "in 3 days", "tomorrow", "today", "overdue" — for titles. */
export function whenText(threshold: Threshold): string {
  if (threshold === 'OVERDUE') return 'is overdue';
  if (threshold === 'DUE_DAY') return 'is due today';
  const days = urgencyRank(threshold);
  return days === 1 ? 'is due tomorrow' : `is due in ${String(days)} days`;
}
