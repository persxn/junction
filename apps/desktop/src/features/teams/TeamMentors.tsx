import { MENTOR_ROLE_LABELS, type TeamDetail } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Star, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { useId, useState } from 'react';

import { addMentor, endMentor, listProfessors, transferPrimary } from '../../api/teams.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { dayText } from '../students/labels.js';
import { disabledReason } from './team-model.js';
import { TransferDialog } from './TransferDialog.js';
import { useTeamActions } from './use-team-actions.js';

/**
 * A team's mentors (§6.2, R95): one primary, any co-mentors, the earlier ones
 * kept with their dates. Adding and ending co-mentors and handing the team over
 * are the primary's (or an administrator's); for anyone else the controls stay
 * on screen, disabled, with the reason beside them.
 */
export function TeamMentors({ team }: { readonly team: TeamDetail }): React.JSX.Element {
  const connection = useBackendConnection();
  const actions = useTeamActions();
  const manageReason = disabledReason(team, 'manageMentors');
  const transferReason = disabledReason(team, 'transferPrimary');
  const reasonId = useId();
  const pickId = useId();
  const [pick, setPick] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const professors = useQuery({
    queryKey: ['professors'],
    queryFn: () => listProfessors(connection),
    enabled: manageReason === undefined || transferReason === undefined,
  });
  const mentorIds = new Set(team.mentors.map((mentor) => mentor.userId));
  const candidates = (professors.data ?? []).filter((person) => !mentorIds.has(person.userId));
  const reason = manageReason ?? transferReason;

  return (
    <section aria-labelledby="team-mentors-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-mentors-heading" className="text-md">
          Mentors
        </h2>
        <button
          type="button"
          disabled={transferReason !== undefined}
          aria-describedby={transferReason === undefined ? undefined : reasonId}
          onClick={() => {
            setError(undefined);
            setTransferring(true);
          }}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
        >
          <ArrowRightLeft aria-hidden="true" className="size-4" />
          Hand over…
        </button>
      </div>
      {reason !== undefined && (
        <p id={reasonId} className="text-sm text-fg-muted">
          {reason}
        </p>
      )}
      <ul className="flex flex-col gap-1.5" aria-label="Current mentors">
        {team.mentors.map((mentor) => {
          const Icon = mentor.role === 'PRIMARY' ? Star : UserCheck;
          return (
            <li key={mentor.id} className="flex items-center gap-2 text-sm">
              <Icon aria-hidden="true" className="size-4 text-accent" />
              <span className="font-medium">{mentor.displayName}</span>
              <span className="text-fg-muted">
                {MENTOR_ROLE_LABELS[mentor.role]} since {dayText(mentor.fromAt)}
              </span>
              {mentor.role === 'CO_MENTOR' && (
                <button
                  type="button"
                  disabled={manageReason !== undefined}
                  aria-describedby={manageReason === undefined ? undefined : reasonId}
                  onClick={() => {
                    void actions.run({
                      team,
                      failure: `${mentor.displayName} is still a mentor`,
                      call: (version) => endMentor(connection, team.id, mentor.id, version),
                    });
                  }}
                  className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-hover disabled:opacity-50"
                >
                  <UserMinus aria-hidden="true" className="size-3.5" />
                  End {mentor.displayName}’s mentoring
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (pick === '') return;
          void actions
            .run({
              team,
              failure: 'The co-mentor was not added',
              call: (version) => addMentor(connection, team.id, pick, version),
            })
            .then(() => {
              setPick('');
            });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={pickId} className="text-sm font-medium">
            Add a co-mentor
          </label>
          <select
            id={pickId}
            value={pick}
            disabled={manageReason !== undefined}
            aria-describedby={manageReason === undefined ? undefined : reasonId}
            onChange={(event) => {
              setPick(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">
              {candidates.length === 0 && professors.isSuccess
                ? 'Every professor already mentors this team'
                : 'Choose a professor'}
            </option>
            {candidates.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={manageReason !== undefined || pick === ''}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
        >
          <UserPlus aria-hidden="true" className="size-4" />
          Add co-mentor
        </button>
      </form>
      {team.pastMentors.length > 0 && (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">Earlier mentors ({team.pastMentors.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {team.pastMentors.map((mentor) => (
              <li key={mentor.id}>
                {mentor.displayName}, {MENTOR_ROLE_LABELS[mentor.role].toLowerCase()},{' '}
                {dayText(mentor.fromAt)} – {dayText(mentor.toAt ?? mentor.fromAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {transferring && (
        <TransferDialog
          team={team}
          professors={professors.data ?? []}
          busy={busy}
          error={error}
          onCancel={() => {
            setTransferring(false);
          }}
          onTransfer={(toUserId, stepAway) => {
            setBusy(true);
            void actions
              .run({
                team,
                failure: 'The team was not handed over',
                call: (version) =>
                  transferPrimary(connection, team.id, { toUserId, stepAway, version }),
              })
              .then((saved) => {
                setBusy(false);
                if (saved === undefined)
                  setError('The team was not handed over — see the message.');
                else setTransferring(false);
              });
          }}
        />
      )}
    </section>
  );
}
