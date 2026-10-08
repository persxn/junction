import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Trophy, UsersRound } from 'lucide-react';
import { useId } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { getTeam, setTeamArchived } from '../../api/teams.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { dayText } from '../students/labels.js';
import { CoverageSection } from './CoverageSection.js';
import { TeamStatusBadge } from './labels.js';
import { MembersSection } from './MembersSection.js';
import { disabledReason } from './team-model.js';
import { TeamMentors } from './TeamMentors.js';
import { teamKey, useTeamActions } from './use-team-actions.js';

/**
 * The Team page (§16.2: members, skill coverage, competitions, mentors). The
 * server decides every write again (§10.1); a control the viewer may not use is
 * disabled with its reason in words. Competitions are WP-19's — until then the
 * section says what will fill it.
 */

const button =
  'flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover';

function TeamGuide(): React.JSX.Element {
  return (
    <Guide id="team-page" title="How a team works">
      <p>
        A team has members — each with an optional role such as “Backend” and at most one{' '}
        <strong>Lead</strong> — and mentors: one <strong>primary mentor</strong> and any number of
        co-mentors. Mentors and administrators change members; only the primary mentor (or an
        administrator) adds mentors, hands the team over or archives it.
      </p>
      <p>
        <strong>Skill coverage</strong> compares the members’ skills with the skills the team needs:
        Covered, Thin or Missing. Only active students count. Use a member’s <kbd>⋮</kbd> menu to
        change their role, make them lead or remove them — removing can be undone from the message
        that follows. Nothing is ever deleted: earlier members and mentors stay listed with their
        dates.
      </p>
    </Guide>
  );
}

export function TeamPage(): React.JSX.Element {
  const { teamId } = useParams({ from: '/teams/$teamId' });
  const connection = useBackendConnection();
  const navigate = useNavigate();
  const actions = useTeamActions();
  const reasonId = useId();
  const team = useQuery({ queryKey: teamKey(teamId), queryFn: () => getTeam(connection, teamId) });

  if (team.isPending) return <Skeleton lines={8} label="Loading the team" />;
  if (team.isError) {
    return (
      <EmptyState
        icon={UsersRound}
        title="This team could not be loaded"
        description={
          isApiProblem(team.error) ? (team.error.detail ?? team.error.title) : String(team.error)
        }
        action={{
          label: 'Back to teams',
          onAction: () => {
            void navigate({ to: '/teams' });
          },
        }}
      />
    );
  }
  const data = team.data;
  const archived = data.status === 'ARCHIVED';
  const editReason = disabledReason(data, 'edit');
  const archiveReason = disabledReason(data, 'archive');
  const headerReason = archiveReason ?? editReason;

  return (
    <article aria-labelledby="team-heading" className="flex flex-col gap-6">
      <Link
        to="/teams"
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All teams
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="team-heading" className="font-display text-xl">
            {data.name}
          </h1>
          <p className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
            <TeamStatusBadge status={data.status} />
            <span>Formed {dayText(data.createdAt)}</span>
          </p>
          {data.description !== null && <p className="max-w-prose text-sm">{data.description}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap gap-2">
            {editReason === undefined ? (
              <Link to="/teams/$teamId/edit" params={{ teamId }} className={button}>
                <Pencil aria-hidden="true" className="size-4" />
                Edit details
              </Link>
            ) : (
              <button
                type="button"
                disabled
                aria-describedby={reasonId}
                className={`${button} opacity-50`}
              >
                <Pencil aria-hidden="true" className="size-4" />
                Edit details
              </button>
            )}
            <button
              type="button"
              disabled={archiveReason !== undefined}
              aria-describedby={archiveReason === undefined ? undefined : reasonId}
              onClick={() => {
                void actions.run({
                  team: data,
                  failure: archived ? 'The team was not unarchived' : 'The team was not archived',
                  call: (version) => setTeamArchived(connection, data.id, !archived, version),
                });
              }}
              className={`${button} disabled:opacity-50`}
            >
              {archived ? (
                <ArchiveRestore aria-hidden="true" className="size-4" />
              ) : (
                <Archive aria-hidden="true" className="size-4" />
              )}
              {archived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
          {headerReason !== undefined && (
            <p id={reasonId} className="max-w-sm text-right text-xs text-fg-muted">
              {headerReason}
            </p>
          )}
        </div>
      </header>

      {archived && (
        <p role="status" className="rounded-md bg-surface-sunken p-3 text-sm">
          This team is archived: everything is kept, and nothing can be changed until it is
          unarchived.
        </p>
      )}

      <TeamGuide />
      <MembersSection team={data} />
      <CoverageSection team={data} />
      <section aria-labelledby="team-competitions-heading" className="flex flex-col gap-2">
        <h2 id="team-competitions-heading" className="text-md">
          Competitions
        </h2>
        <p className="flex items-start gap-2 rounded-md border border-dashed border-line p-3 text-sm text-fg-muted">
          <Trophy aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          No competitions yet. Once this team is assigned to an event on the Competitions screen,
          its competitions and their progress appear here.
        </p>
      </section>
      <TeamMentors team={data} />
    </article>
  );
}
