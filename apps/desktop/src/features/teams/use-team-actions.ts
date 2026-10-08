import type { TeamDetail, TeamMember } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { addMember, removeMember, updateMember } from '../../api/teams.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { readdOf } from './team-model.js';

/**
 * The Team page's writes (WP-18 step 6, §16.3). Each one may change the page
 * first, then asks the server; the answer replaces the page, a failure puts it
 * back and says why. A stale `version` — someone else changed the team — offers
 * a reload instead of retrying over their change. Removing a member is the
 * reversible one: its toast carries Undo, which re-adds the student with the
 * same role label and lead.
 */

export const teamKey = (id: string) => ['teams', 'detail', id] as const;
export const TEAM_LIST_KEY = ['teams', 'list'] as const;

export const CONFLICT_TEXT = 'Someone else changed this team — reload to see their changes.';

export interface TeamWrite {
  /** The page as it was, for the version and the rollback. */
  readonly team: TeamDetail;
  /** What failed, as a toast title. */
  readonly failure: string;
  readonly call: (version: number) => Promise<TeamDetail>;
  /** The page to show while the server answers. */
  readonly optimistic?: (team: TeamDetail) => TeamDetail;
}

export interface TeamActions {
  /** Resolves to the saved team, or `undefined` once the failure is shown. */
  readonly run: (write: TeamWrite) => Promise<TeamDetail | undefined>;
  readonly removeMember: (team: TeamDetail, member: TeamMember) => void;
  readonly setLead: (team: TeamDetail, member: TeamMember, isLead: boolean) => void;
  readonly setRole: (
    team: TeamDetail,
    member: TeamMember,
    roleLabel: string | null,
  ) => Promise<TeamDetail | undefined>;
}

export function problemText(cause: unknown): string {
  if (!isApiProblem(cause)) return 'The local service did not answer.';
  if (cause.code === 'TEAM_VERSION_CONFLICT') return CONFLICT_TEXT;
  return cause.detail ?? cause.title;
}

export function useTeamActions(): TeamActions {
  const client = useQueryClient();
  const connection = useBackendConnection();
  const toast = useToast();

  const run = useCallback(
    async ({ team, failure, call, optimistic }: TeamWrite): Promise<TeamDetail | undefined> => {
      if (optimistic !== undefined) client.setQueryData(teamKey(team.id), optimistic(team));
      try {
        const saved = await call(team.version);
        client.setQueryData(teamKey(team.id), saved);
        void client.invalidateQueries({ queryKey: TEAM_LIST_KEY });
        void client.invalidateQueries({ queryKey: ['students'] });
        return saved;
      } catch (cause) {
        client.setQueryData(teamKey(team.id), team);
        if (isApiProblem(cause) && cause.code === 'TEAM_VERSION_CONFLICT') {
          toast.show({
            tone: 'warning',
            title: 'Someone else changed this team',
            description: CONFLICT_TEXT,
            action: {
              label: 'Reload',
              onAction: () => {
                void client.invalidateQueries({ queryKey: teamKey(team.id) });
              },
            },
          });
        } else {
          toast.show({ tone: 'danger', title: failure, description: problemText(cause) });
        }
        return undefined;
      }
    },
    [client, toast],
  );

  const removeOne = useCallback(
    (team: TeamDetail, member: TeamMember): void => {
      void run({
        team,
        failure: `${member.fullName} was not removed`,
        call: (version) => removeMember(connection, team.id, member.id, version),
        optimistic: (current) => ({
          ...current,
          members: current.members.filter((row) => row.id !== member.id),
        }),
      }).then((saved) => {
        if (saved === undefined) return;
        toast.show({
          tone: 'info',
          title: `${member.fullName} left ${team.name}`,
          action: {
            label: 'Undo',
            onAction: () => {
              const latest = client.getQueryData<TeamDetail>(teamKey(team.id)) ?? saved;
              void run({
                team: latest,
                failure: `${member.fullName} was not added back`,
                call: (version) => addMember(connection, team.id, { ...readdOf(member), version }),
              });
            },
          },
        });
      });
    },
    [client, connection, run, toast],
  );

  const setLead = useCallback(
    (team: TeamDetail, member: TeamMember, isLead: boolean): void => {
      void run({
        team,
        failure: isLead ? `${member.fullName} was not made lead` : 'The lead was not changed',
        call: (version) => updateMember(connection, team.id, member.id, { isLead, version }),
        // Making a lead clears the old one (R95), on the page as on the server.
        optimistic: (current) => ({
          ...current,
          members: current.members.map((row) =>
            row.id === member.id ? { ...row, isLead } : isLead ? { ...row, isLead: false } : row,
          ),
        }),
      });
    },
    [connection, run],
  );

  const setRole = useCallback(
    (team: TeamDetail, member: TeamMember, roleLabel: string | null) =>
      run({
        team,
        failure: 'The role was not saved',
        call: (version) => updateMember(connection, team.id, member.id, { roleLabel, version }),
        optimistic: (current) => ({
          ...current,
          members: current.members.map((row) =>
            row.id === member.id ? { ...row, roleLabel } : row,
          ),
        }),
      }),
    [connection, run],
  );

  return useMemo(
    () => ({ run, removeMember: removeOne, setLead, setRole }),
    [run, removeOne, setLead, setRole],
  );
}
