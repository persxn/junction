import { ENGAGEMENT_STATUS_LABELS } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Trophy } from 'lucide-react';

import { studentHistory } from '../../api/outcomes.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { dayText } from '../students/labels.js';
import { OutcomeBadge } from './OutcomeBadge.js';
import { formatPrize } from './outcome-model.js';

/**
 * The Student page's "Competitions & outcomes" (§16.2, R104, WP-21): every
 * competition the student was on the roster of, newest first, with the
 * team's result — shown only if they were still on the roster when it was
 * recorded, otherwise "Left before the result".
 */
export function CompetitionHistory({
  studentId,
}: {
  readonly studentId: string;
}): React.JSX.Element {
  const connection = useBackendConnection();
  const history = useQuery({
    queryKey: ['students', 'history', studentId],
    queryFn: () => studentHistory(connection, studentId),
  });

  let body: React.JSX.Element;
  if (history.isPending) body = <Skeleton lines={3} label="Loading the competition history" />;
  else if (history.isError) {
    body = (
      <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
        The competition history did not load: {problemText(history.error)}
      </p>
    );
  } else if (history.data.competitions.length === 0) {
    body = (
      <p className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line p-3 text-sm text-fg-muted">
        <Trophy aria-hidden="true" className="size-4 shrink-0" />
        No competitions yet. Find an event on
        <Link to="/discover" search={DEFAULT_SEARCH} className="text-fg underline">
          Discover
        </Link>
        and assign it to this student or their team.
      </p>
    );
  } else {
    body = (
      <ul aria-label="Competitions and outcomes" className="flex flex-col gap-2">
        {history.data.competitions.map((row) => (
          <li
            key={row.competitionId}
            className="flex flex-col gap-0.5 rounded-md border border-line p-2 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <Link
                to="/competitions/$competitionId"
                params={{ competitionId: row.competitionId }}
                className="font-medium hover:underline"
              >
                {row.eventTitle}
              </Link>
              <span className="text-fg-muted">
                {row.teamName ?? 'Individual'} · {ENGAGEMENT_STATUS_LABELS[row.status]}
              </span>
            </span>
            {row.outcomeState === 'SHOWN' && row.outcome !== null && (
              <span className="flex flex-wrap items-center gap-2">
                <OutcomeBadge result={row.outcome.result} rank={row.outcome.rank} />
                {row.outcome.prizeText !== null && <span>{row.outcome.prizeText}</span>}
                {row.outcome.prizeMinor !== null && row.outcome.prizeCurrency !== null && (
                  <span>{formatPrize(row.outcome.prizeMinor, row.outcome.prizeCurrency)}</span>
                )}
              </span>
            )}
            {row.outcomeState === 'LEFT_BEFORE_RESULT' && (
              <span className="text-fg-muted">Left before the result</span>
            )}
            <span className="text-xs text-fg-muted">
              On the roster from {dayText(row.addedAt)}
              {row.removedAt === null ? '' : ` to ${dayText(row.removedAt)}`}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="competition-history-heading" className="flex flex-col gap-2">
      <h2 id="competition-history-heading" className="text-md">
        Competitions &amp; outcomes
      </h2>
      {body}
    </section>
  );
}
