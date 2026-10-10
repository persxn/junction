import { ACTIVE_COMPETITION_STATUSES, type InsightsResponse } from '@compintel/contracts';
import { Link } from '@tanstack/react-router';
import { CalendarCheck, CalendarX, Flame, Trophy } from 'lucide-react';

import { AnimatedCount } from '../../components/AnimatedCount.js';
import { count, fractionText } from './insights-model.js';

const TILE =
  'ci-fx-card flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-3 text-sm';

/**
 * The headline numbers (WP-33, R69). "Active now" links to the Competitions
 * list with exactly its filter, and is that list's own total (R107).
 */
export function InsightsTiles({
  insights,
}: {
  readonly insights: InsightsResponse;
}): React.JSX.Element {
  const { deadlines, streaks, funnel } = insights;
  return (
    <ul aria-label="Headline numbers" className="ci-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
      <li>
        <Link
          to="/competitions"
          search={{ view: 'list', status: [...ACTIVE_COMPETITION_STATUSES], mine: false } as never}
          className={`${TILE} hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent`}
        >
          <AnimatedCount
            value={insights.activeNow}
            format={count}
            className="font-display text-2xl"
            testId="insights-active-now"
          />
          <span className="text-fg-muted">Active competitions now</span>
        </Link>
      </li>
      <li className={TILE}>
        <span className="flex items-center gap-1.5 font-display text-lg">
          <Trophy aria-hidden="true" className="size-4 text-accent" />
          {fractionText(funnel.completion)}
        </span>
        <span className="text-fg-muted">Completed, not counting withdrawn</span>
      </li>
      <li className={TILE}>
        <span className="flex flex-wrap items-center gap-x-3 font-display text-lg">
          <span className="inline-flex items-center gap-1">
            <CalendarCheck aria-hidden="true" className="size-4 text-success" />
            {count(deadlines.met)} met
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarX aria-hidden="true" className="size-4 text-danger" />
            {count(deadlines.missed)} missed
          </span>
        </span>
        <span className="text-fg-muted">
          Stage deadlines in this period
          {deadlines.undated > 0 && ` · ${count(deadlines.undated)} without a due date`}
        </span>
      </li>
      <li className={TILE}>
        <span className="flex items-center gap-1.5 font-display text-lg">
          <Flame aria-hidden="true" className="size-4 text-warning" />
          {count(streaks.current)} {streaks.current === 1 ? 'week' : 'weeks'} running
        </span>
        <span className="text-fg-muted">
          Longest {count(streaks.longest)} · active in {count(streaks.activeWeeks)} of{' '}
          {count(streaks.weeksInRange)} weeks
        </span>
      </li>
    </ul>
  );
}
