import {
  ENGAGEMENT_STATUS_LABELS,
  OUTCOME_RESULT_LABELS,
  type Fraction,
  type InsightsResponse,
  type MonthPoint,
} from '@compintel/contracts';

import { EVENT_TYPE_LABELS, MODE_LABELS } from '../discover/labels.js';

/**
 * What the Insights screen says, as pure functions (WP-33, R69). Nothing here
 * computes a new fact: it words the counts the backend returned, and a rate is
 * always shown with the counts it came from.
 */

export interface BarRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Extra words after the value, e.g. "of 12". */
  readonly detail?: string;
}

const NUMBER = new Intl.NumberFormat('en-IN');
const MONTH = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function count(value: number): string {
  return NUMBER.format(value);
}

/** "3 of 5 (60%)", or "none yet" when there is nothing to divide by. */
export function fractionText(fraction: Fraction): string {
  if (fraction.denominator === 0) return 'none yet';
  const percent = Math.round((fraction.numerator / fraction.denominator) * 100);
  return `${count(fraction.numerator)} of ${count(fraction.denominator)} (${String(percent)}%)`;
}

/** `2026-10` → "Oct 2026". */
export function monthLabel(month: string): string {
  return MONTH.format(new Date(`${month}-01T00:00:00Z`));
}

export function funnelRows(insights: InsightsResponse): BarRow[] {
  const steps = insights.funnel.steps;
  return steps.map((step, index) => {
    const previous = index === 0 ? undefined : steps[index - 1];
    const detail =
      previous === undefined
        ? undefined
        : `${fractionText({ numerator: step.reached, denominator: previous.reached })} of ${ENGAGEMENT_STATUS_LABELS[previous.status].toLowerCase()}`;
    return {
      key: step.status,
      label: ENGAGEMENT_STATUS_LABELS[step.status],
      value: step.reached,
      ...(detail === undefined ? {} : { detail }),
    };
  });
}

export function typeRows(insights: InsightsResponse): BarRow[] {
  return insights.eventsByType.map((row) => ({
    key: row.type,
    label: EVENT_TYPE_LABELS[row.type],
    value: row.count,
  }));
}

export function modeRows(insights: InsightsResponse): BarRow[] {
  return insights.eventsByMode.map((row) => ({
    key: row.mode,
    label: MODE_LABELS[row.mode],
    value: row.count,
  }));
}

/** Outcomes, best first, leaving out results nobody has. */
export function outcomeRows(insights: InsightsResponse): BarRow[] {
  const order = [
    'WINNER',
    'RUNNER_UP',
    'FINALIST',
    'QUALIFIED',
    'PARTICIPATED',
    'OTHER',
    'DID_NOT_PARTICIPATE',
  ] as const;
  const byResult = new Map(insights.outcomes.map((row) => [row.result, row.count]));
  return order
    .map((result) => ({
      key: result,
      label: OUTCOME_RESULT_LABELS[result],
      value: byResult.get(result) ?? 0,
    }))
    .filter((row) => row.value > 0);
}

export function sourceRows(insights: InsightsResponse): BarRow[] {
  return insights.sources.map((row) => ({
    key: row.sourceId,
    label: row.name,
    value: row.assigned,
    detail: `of ${count(row.events)} new ${row.events === 1 ? 'event' : 'events'}`,
  }));
}

export function mentorRows(insights: InsightsResponse): BarRow[] {
  return insights.mentors.map((row) => ({
    key: row.userId,
    label: row.name,
    value: row.active,
    detail: `active now · ${count(row.total)} in this period`,
  }));
}

/** One sentence for a chart's accessible summary: the largest values first. */
export function barSummary(title: string, rows: readonly BarRow[]): string {
  if (rows.length === 0) return `${title}: nothing in this period.`;
  const top = [...rows]
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((row) => `${row.label} ${count(row.value)}`)
    .join(', ');
  return `${title}: ${top}${rows.length > 3 ? `, and ${String(rows.length - 3)} more` : ''}.`;
}

export function participationSummary(points: readonly MonthPoint[]): string {
  const assigned = points.reduce((sum, point) => sum + point.assigned, 0);
  const busiest = [...points].sort((a, b) => b.active - a.active)[0];
  if (busiest === undefined || (assigned === 0 && busiest.active === 0)) {
    return 'Participation over time: no competitions in this period.';
  }
  return `Participation over time: ${count(assigned)} competitions assigned across ${String(points.length)} months; the busiest month was ${monthLabel(busiest.month)} with ${count(busiest.active)} active.`;
}

/** "Nice" upper bound for an axis: 1, 2, 5 × 10ⁿ. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

/** Ranges the screen offers; `undefined` lets the backend use its default. */
export const RANGE_PRESETS = [
  { id: '12m', label: 'Last 12 months' },
  { id: '3m', label: 'Last 3 months' },
  { id: 'year', label: 'This calendar year' },
  { id: 'all', label: 'Last 5 years' },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]['id'];

/** The `from` for a preset, as a Kolkata `YYYY-MM-DD`, given today's date. */
export function presetFrom(preset: RangePreset, today: string): string | undefined {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case '12m':
      return undefined;
    case '3m': {
      const start = new Date(Date.UTC(year, month - 3, 1));
      return start.toISOString().slice(0, 10);
    }
    case 'year':
      return `${String(year)}-01-01`;
    case 'all':
      // The first of next month, five years back: inside the backend's 1,830-day cap.
      return new Date(Date.UTC(year - 5, month, 1)).toISOString().slice(0, 10);
  }
}

/** Today in Asia/Kolkata (A7). */
export function kolkataToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}
