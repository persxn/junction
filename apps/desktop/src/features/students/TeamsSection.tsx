import type { StudentDetail } from '@compintel/contracts';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';

import { LeadBadge, TeamStatusBadge } from '../teams/labels.js';
import { dayText } from './labels.js';

/**
 * A student's teams (§16.2, WP-18 step 5): the current memberships with their
 * role and lead, each linking to its team; the earlier ones with their dates.
 */
export function TeamsSection({ student }: { readonly student: StudentDetail }): React.JSX.Element {
  const current = student.teams.filter((team) => team.leftAt === null);
  const past = student.teams.filter((team) => team.leftAt !== null);
  return (
    <section aria-labelledby="teams-heading" className="flex flex-col gap-2">
      <h2 id="teams-heading" className="text-md">
        Teams
      </h2>
      {current.length === 0 ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed border-line p-3 text-sm text-fg-muted">
          <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Not in a team yet. Add this student to a team from the team’s page on the Teams screen.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Current teams">
          {current.map((team) => (
            <li
              key={`${team.teamId}-${team.joinedAt}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <Link
                to="/teams/$teamId"
                params={{ teamId: team.teamId }}
                className="font-medium text-fg hover:underline"
              >
                {team.teamName}
              </Link>
              <span className="text-fg-muted">{team.roleLabel ?? 'No role set'}</span>
              {team.isLead && <LeadBadge />}
              {team.teamStatus === 'ARCHIVED' && <TeamStatusBadge status={team.teamStatus} />}
              <span className="text-fg-muted">since {dayText(team.joinedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">Earlier teams ({past.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {past.map((team) => (
              <li key={`${team.teamId}-${team.joinedAt}`}>
                {team.teamName}
                {team.roleLabel !== null && ` (${team.roleLabel})`}, {dayText(team.joinedAt)} –{' '}
                {dayText(team.leftAt ?? team.joinedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
