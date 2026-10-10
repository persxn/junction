import type { InsightsResponse } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChartNoAxesCombined } from 'lucide-react';
import { useId, useState } from 'react';

import { getInsights } from '../../api/appearance.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { BarList, BarTable, ChartFrame, MonthColumns, MonthTable } from './charts.js';
import {
  barSummary,
  count,
  funnelRows,
  kolkataToday,
  mentorRows,
  modeRows,
  outcomeRows,
  participationSummary,
  presetFrom,
  RANGE_PRESETS,
  sourceRows,
  typeRows,
  type BarRow,
  type RangePreset,
} from './insights-model.js';
import { InsightsTiles } from './InsightsTiles.js';
import { MilestoneCelebration } from './MilestoneCelebration.js';

/**
 * Insights (WP-33, R69, ADR-0019): what the department has actually done, from
 * rows it already holds. No estimate, no extrapolation, no AI — every number
 * here is a count the backend can show its working for.
 */
export function InsightsPage(): React.JSX.Element {
  const id = useId();
  const connection = useBackendConnection();
  const [preset, setPreset] = useState<RangePreset>('12m');
  const from = presetFrom(preset, kolkataToday(new Date()));
  const insights = useQuery({
    queryKey: ['insights', from ?? 'default'],
    queryFn: () => getInsights(connection, from === undefined ? {} : { from }),
  });

  return (
    <section aria-labelledby={`${id}-heading`} className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 id={`${id}-heading`} className="ci-heading-sweep font-display text-xl">
          Insights
        </h1>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={`${id}-period`}>Period</label>
          <select
            id={`${id}-period`}
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value as RangePreset);
            }}
            className="rounded-md border border-line bg-surface px-2 py-1"
          >
            {RANGE_PRESETS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <Guide id="insights" title="About Insights">
        <p>
          What your department has achieved, counted from the competitions, outcomes and deadlines
          already recorded in Junction. Nothing is estimated or predicted. Each chart has a{' '}
          <strong>Show as table</strong> view, and the active count opens the Competitions list it
          comes from.
        </p>
      </Guide>

      <InsightsBody query={insights} />
    </section>
  );
}

function InsightsBody({
  query,
}: {
  readonly query: ReturnType<typeof useQuery<InsightsResponse>>;
}): React.JSX.Element {
  const navigate = useNavigate();
  if (query.isPending) return <Skeleton lines={6} label="Loading insights" />;
  if (query.isError) {
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md bg-danger-surface p-3 text-sm"
      >
        Insights did not load: {problemText(query.error)}
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-surface-hover"
        >
          Try again
        </button>
      </p>
    );
  }
  const data = query.data;
  if (data.isEmpty) {
    return (
      <EmptyState
        icon={ChartNoAxesCombined}
        title="Nothing to show yet"
        description="Once your department assigns its first competition, this page shows participation month by month, how far competitions get, outcomes and wins, deadlines met, which sources found the events you took on, and your busiest students, teams and mentors."
        action={{
          label: 'Find an event in Discover',
          onAction: () => {
            void navigate({ to: '/discover', search: DEFAULT_SEARCH });
          },
        }}
      />
    );
  }

  const bars = (
    title: string,
    rows: readonly BarRow[],
    valueLabel: string,
    empty: string,
    max?: number,
  ) => (
    <ChartFrame
      title={title}
      summary={barSummary(title, rows)}
      table={<BarTable rows={rows} valueLabel={valueLabel} />}
    >
      <BarList rows={rows} empty={empty} {...(max === undefined ? {} : { max })} />
    </ChartFrame>
  );
  const funnel = funnelRows(data);
  const people = (rows: typeof data.students.top): BarRow[] =>
    rows.map((row) => ({ key: row.id, label: row.name, value: row.count }));

  return (
    <div className="flex flex-col gap-5">
      <MilestoneCelebration milestones={data.milestones} />
      <InsightsTiles insights={data} />

      <ChartFrame
        title="Participation over time"
        summary={participationSummary(data.participation)}
        table={<MonthTable points={data.participation} />}
      >
        <MonthColumns points={data.participation} />
      </ChartFrame>

      <div className="grid gap-5 lg:grid-cols-2">
        {bars(
          `From considering to completed · ${count(data.funnel.total)} competitions, ${count(data.funnel.withdrawn)} withdrawn, ${count(data.funnel.notSelected)} not selected`,
          funnel,
          'Reached',
          'No competitions started in this period.',
          funnel[0]?.value,
        )}
        {bars('Outcomes', outcomeRows(data), 'Results', 'No results recorded in this period.')}
        {bars('Events by type', typeRows(data), 'Events', 'No events taken on in this period.')}
        {bars('Events by mode', modeRows(data), 'Events', 'No events taken on in this period.')}
        {bars(
          `Students · ${count(data.students.distinct)} took part`,
          people(data.students.top),
          'Competitions',
          'No students on a competition in this period.',
        )}
        {bars(
          `Teams · ${count(data.teams.distinct)} took part`,
          people(data.teams.top),
          'Competitions',
          'No team competitions in this period.',
        )}
        {bars('Mentor load', mentorRows(data), 'Active now', 'Nobody is mentoring a competition.')}
        {bars(
          'Where assigned events came from',
          sourceRows(data),
          'Assigned events',
          'No source has reported an event in this period.',
        )}
      </div>
    </div>
  );
}
