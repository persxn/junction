import type { CompetitionRef } from '@compintel/contracts';
import { Link } from '@tanstack/react-router';
import { Trophy } from 'lucide-react';

import { CompetitionStatus, KIND_LABELS } from './labels.js';

/**
 * The Competitions section of the Team and Student pages (WP-19 step 6): each
 * competition with its status in words, linking to its page; an empty state
 * that says where competitions come from.
 */
export function CompetitionRefs({
  refs,
  empty,
  showTeam,
}: {
  readonly refs: readonly CompetitionRef[];
  readonly empty: string;
  /** On the Student page, which team (or "Individual") the entry was. */
  readonly showTeam: boolean;
}): React.JSX.Element {
  return (
    <section aria-labelledby="competitions-section-heading" className="flex flex-col gap-2">
      <h2 id="competitions-section-heading" className="text-md">
        Competitions
      </h2>
      {refs.length === 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed border-line p-3 text-sm text-fg-muted">
          <Trophy aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {empty}
        </p>
      ) : (
        <ul aria-label="Competitions" className="flex flex-col gap-1.5">
          {refs.map((ref) => (
            <li key={ref.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                to="/competitions/$competitionId"
                params={{ competitionId: ref.id }}
                className="font-medium hover:underline"
              >
                {ref.eventTitle}
              </Link>
              <CompetitionStatus status={ref.status} />
              {showTeam && (
                <span className="text-fg-muted">{ref.teamName ?? KIND_LABELS[ref.kind]}</span>
              )}
              {!ref.onRoster && (
                <span className="text-xs text-fg-muted">No longer on the roster</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
