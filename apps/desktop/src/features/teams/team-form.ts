import {
  TEAM_INITIAL_MEMBERS_MAX,
  TEAM_NAME_MAX,
  TEAM_TARGETS_MAX,
  type TeamCreateInput,
  type TeamDetail,
  type TeamUpdateRequest,
} from '@compintel/contracts';

import { parseTargets } from './team-model.js';

/**
 * The team form's state and its checks (WP-18 step 6), kept out of React so
 * they are tested as plain functions. The server checks everything again.
 */

export interface DraftMember {
  readonly studentId: string;
  readonly fullName: string;
  readonly universityId: string;
  readonly roleLabel: string;
  readonly isLead: boolean;
}

export interface TeamFormState {
  readonly name: string;
  readonly description: string;
  readonly targets: string;
  /** Only on create; the Team page manages members afterwards. */
  readonly members: readonly DraftMember[];
  /** An administrator's choice of primary mentor; `''` is "me". */
  readonly primaryUserId: string;
}

export const emptyTeamForm = (): TeamFormState => ({
  name: '',
  description: '',
  targets: '',
  members: [],
  primaryUserId: '',
});

export const teamFormFrom = (team: TeamDetail): TeamFormState => ({
  name: team.name,
  description: team.description ?? '',
  targets: team.targets.join(', '),
  members: [],
  primaryUserId: '',
});

export type TeamFormErrors = Partial<Record<'name' | 'targets' | 'members' | 'primary', string>>;

export function validateTeamForm(form: TeamFormState, needsPrimary: boolean): TeamFormErrors {
  const errors: { -readonly [K in keyof TeamFormErrors]: string } = {};
  const name = form.name.trim();
  if (name.length < 2) errors.name = 'Give the team a name of at least 2 characters.';
  else if (name.length > TEAM_NAME_MAX)
    errors.name = `Keep the name to ${String(TEAM_NAME_MAX)} characters.`;
  if (parseTargets(form.targets).length > TEAM_TARGETS_MAX)
    errors.targets = `At most ${String(TEAM_TARGETS_MAX)} skills.`;
  if (form.members.length > TEAM_INITIAL_MEMBERS_MAX)
    errors.members = `Add at most ${String(TEAM_INITIAL_MEMBERS_MAX)} members here; add more on the team’s page.`;
  if (needsPrimary && form.primaryUserId === '')
    errors.primary = 'Choose the professor who will be the primary mentor.';
  return errors;
}

/** Making one member lead clears the others: a team has at most one. */
export function withLead(members: readonly DraftMember[], studentId: string): DraftMember[] {
  return members.map((member) => ({
    ...member,
    isLead: member.studentId === studentId ? !member.isLead : false,
  }));
}

export function toCreateRequest(form: TeamFormState): TeamCreateInput {
  const description = form.description.trim();
  return {
    name: form.name.trim(),
    ...(description === '' ? {} : { description }),
    targets: parseTargets(form.targets),
    members: form.members.map((member) => ({
      studentId: member.studentId,
      ...(member.roleLabel.trim() === '' ? {} : { roleLabel: member.roleLabel.trim() }),
      ...(member.isLead ? { isLead: true } : {}),
    })),
    ...(form.primaryUserId === '' ? {} : { primaryUserId: form.primaryUserId }),
  };
}

export function toUpdateRequest(form: TeamFormState, team: TeamDetail): TeamUpdateRequest {
  return {
    name: form.name.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    targets: parseTargets(form.targets),
    version: team.version,
  };
}
