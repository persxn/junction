import type { TeamCreateInput, TeamUpdateRequest } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, UsersRound } from 'lucide-react';

import { createTeam, getTeam, listProfessors, updateTeam } from '../../api/teams.js';
import { useAuth } from '../../auth/auth-context.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { emptyTeamForm, teamFormFrom, toCreateRequest, toUpdateRequest } from './team-form.js';
import { TeamForm } from './TeamForm.js';
import { disabledReason } from './team-model.js';
import { problemText, TEAM_LIST_KEY, teamKey } from './use-team-actions.js';

/** "Create a team" and "Edit details" (WP-18 step 6) — one form, two routes. */

const errorText = (error: unknown): string | undefined =>
  error === null || error === undefined ? undefined : problemText(error);

function FormGuide(): React.JSX.Element {
  return (
    <Guide id="team-form" title="Filling in this form">
      <p>
        Only the <strong>name</strong> is required, and no two active teams may share one (capital
        letters and extra spaces do not count). You become the team’s{' '}
        <strong>primary mentor</strong>; an administrator chooses who it is instead.
      </p>
      <p>
        <strong>Skills this team needs</strong> are what the coverage chips compare the members
        against. Only active students can join; one student can be in several teams, with a
        different role in each.
      </p>
    </Guide>
  );
}

const backLink = 'flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg';

export function NewTeamPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAuth();
  const isAdmin = me?.roles.includes('ADMINISTRATOR') === true;
  const selfAllowed = me?.roles.includes('PROFESSOR') === true;
  const professors = useQuery({
    queryKey: ['professors'],
    queryFn: () => listProfessors(connection),
    enabled: isAdmin,
  });
  const create = useMutation({
    mutationFn: (body: TeamCreateInput) => createTeam(connection, body),
    onSuccess: (saved) => {
      client.setQueryData(teamKey(saved.id), saved);
      void client.invalidateQueries({ queryKey: TEAM_LIST_KEY });
      void client.invalidateQueries({ queryKey: ['students'] });
      toast.show({ tone: 'success', title: `${saved.name} was created` });
      void navigate({ to: '/teams/$teamId', params: { teamId: saved.id } });
    },
  });
  if (isAdmin && professors.isPending) return <Skeleton lines={6} label="Loading the form" />;

  return (
    <section aria-labelledby="team-form-heading" className="flex flex-col gap-4">
      <Link to="/teams" className={backLink}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        All teams
      </Link>
      <h1 id="team-form-heading" className="font-display text-xl">
        Create a team
      </h1>
      <FormGuide />
      <TeamForm
        mode="create"
        initial={emptyTeamForm()}
        {...(isAdmin
          ? {
              primaryChoice: {
                professors: (professors.data ?? []).filter(
                  (person) => person.userId !== me?.user.id,
                ),
                selfAllowed,
              },
            }
          : {})}
        busy={create.isPending}
        serverError={errorText(create.error)}
        onSubmit={(form) => {
          create.mutate(toCreateRequest(form));
        }}
        onCancel={() => {
          void navigate({ to: '/teams' });
        }}
      />
    </section>
  );
}

export function EditTeamPage(): React.JSX.Element {
  const { teamId } = useParams({ from: '/teams/$teamId/edit' });
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const team = useQuery({ queryKey: teamKey(teamId), queryFn: () => getTeam(connection, teamId) });
  const save = useMutation({
    mutationFn: (body: TeamUpdateRequest) => updateTeam(connection, teamId, body),
    onSuccess: (saved) => {
      client.setQueryData(teamKey(saved.id), saved);
      void client.invalidateQueries({ queryKey: TEAM_LIST_KEY });
      toast.show({ tone: 'success', title: `${saved.name} was saved` });
      void navigate({ to: '/teams/$teamId', params: { teamId } });
    },
  });
  const back = (): void => {
    void navigate({ to: '/teams/$teamId', params: { teamId } });
  };

  if (team.isPending) return <Skeleton lines={6} label="Loading the team" />;
  if (team.isError) {
    return (
      <EmptyState
        icon={UsersRound}
        title="This team could not be loaded"
        description={errorText(team.error) ?? ''}
        action={{
          label: 'Back to teams',
          onAction: () => {
            void navigate({ to: '/teams' });
          },
        }}
      />
    );
  }
  const reason = disabledReason(team.data, 'edit');
  if (reason !== undefined) {
    return (
      <EmptyState
        icon={UsersRound}
        title="You cannot edit this team"
        description={reason}
        action={{ label: 'Back to the team', onAction: back }}
      />
    );
  }
  return (
    <section aria-labelledby="team-form-heading" className="flex flex-col gap-4">
      <Link to="/teams/$teamId" params={{ teamId }} className={backLink}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to {team.data.name}
      </Link>
      <h1 id="team-form-heading" className="font-display text-xl">
        Edit {team.data.name}
      </h1>
      <FormGuide />
      <TeamForm
        mode="edit"
        initial={teamFormFrom(team.data)}
        busy={save.isPending}
        serverError={errorText(save.error)}
        onSubmit={(form) => {
          save.mutate(toUpdateRequest(form, team.data));
        }}
        onCancel={back}
      />
    </section>
  );
}
