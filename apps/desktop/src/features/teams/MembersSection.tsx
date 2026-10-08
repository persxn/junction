import type { TeamDetail, TeamMember } from '@compintel/contracts';
import { Link } from '@tanstack/react-router';
import { CirclePause } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { addMember } from '../../api/teams.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { dayText } from '../students/labels.js';
import { LeadBadge } from './labels.js';
import { MemberMenu, RoleDialog } from './MemberMenu.js';
import { StudentPicker } from './StudentPicker.js';
import { disabledReason } from './team-model.js';
import { useTeamActions } from './use-team-actions.js';

/**
 * A team's members (§16.2, R95): the open memberships with role label, a Lead
 * badge and "Inactive" where the student was deactivated later; a typeahead to
 * add an ACTIVE student; the closed memberships, kept, with their dates.
 */

function MemberRow(props: {
  readonly member: TeamMember;
  readonly menu: React.ReactNode;
}): React.JSX.Element {
  const { member } = props;
  const inactive = member.studentStatus !== 'ACTIVE';
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 text-sm">
      <Link
        to="/students/$studentId"
        params={{ studentId: member.studentId }}
        className="font-medium text-fg hover:underline"
      >
        {member.fullName}
      </Link>
      <span className="font-mono text-fg-muted">{member.universityId}</span>
      {member.isLead && <LeadBadge />}
      {inactive && (
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <CirclePause aria-hidden="true" className="size-3.5" />
          Inactive — not counted in coverage
        </span>
      )}
      <span className="text-fg-muted">{member.roleLabel ?? 'No role set'}</span>
      {member.skills.length > 0 && (
        <span className="text-xs text-fg-muted">{member.skills.join(', ')}</span>
      )}
      <span className="ml-auto">{props.menu}</span>
    </li>
  );
}

export function MembersSection({ team }: { readonly team: TeamDetail }): React.JSX.Element {
  const connection = useBackendConnection();
  const actions = useTeamActions();
  const reasonId = useId();
  const [editing, setEditing] = useState<TeamMember | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const reason = disabledReason(team, 'edit');
  const exclude = useMemo(() => new Set(team.members.map((member) => member.studentId)), [team]);

  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <h2 id="members-heading" className="text-md">
        Members ({team.members.length})
      </h2>
      {reason !== undefined && (
        <p id={reasonId} className="text-sm text-fg-muted">
          {reason}
        </p>
      )}
      {team.members.length === 0 ? (
        <p className="text-sm text-fg-muted">No members yet. Add the first one below.</p>
      ) : (
        <ul className="flex flex-col" aria-label="Current members">
          {team.members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              menu={
                reason === undefined ? (
                  <MemberMenu
                    member={member}
                    onEditRole={() => {
                      setEditing(member);
                    }}
                    onToggleLead={() => {
                      actions.setLead(team, member, !member.isLead);
                    }}
                    onRemove={() => {
                      actions.removeMember(team, member);
                    }}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      )}
      <div className="max-w-md">
        <StudentPicker
          label="Add a member"
          exclude={exclude}
          disabled={reason !== undefined}
          {...(reason === undefined ? {} : { describedBy: reasonId })}
          onPick={(student) => {
            void actions.run({
              team,
              failure: `${student.fullName} was not added`,
              call: (version) => addMember(connection, team.id, { studentId: student.id, version }),
            });
          }}
        />
      </div>
      {team.pastMembers.length > 0 && (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">Earlier members ({team.pastMembers.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {team.pastMembers.map((member) => (
              <li key={member.id}>
                {member.fullName}
                {member.roleLabel !== null && ` (${member.roleLabel})`}, {dayText(member.joinedAt)}{' '}
                – {dayText(member.leftAt ?? member.joinedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {editing !== undefined && (
        <RoleDialog
          member={editing}
          busy={busy}
          onCancel={() => {
            setEditing(undefined);
          }}
          onSave={(roleLabel) => {
            setBusy(true);
            void actions.setRole(team, editing, roleLabel).then(() => {
              setBusy(false);
              setEditing(undefined);
            });
          }}
        />
      )}
    </section>
  );
}
