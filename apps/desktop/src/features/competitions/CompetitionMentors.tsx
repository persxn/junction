import { MENTOR_ROLE_LABELS, type CompetitionDetail } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Star, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { useId, useState } from 'react';

import {
  addCompetitionMentor,
  endCompetitionMentor,
  transferCompetitionPrimary,
} from '../../api/competitions.js';
import { listProfessors } from '../../api/teams.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { dayText } from '../students/labels.js';
import { TransferDialog } from '../teams/TransferDialog.js';
import { whoOf } from './board-model.js';
import { useCompetitionWrites } from './use-competition-writes.js';

/**
 * A competition's own mentors (R96): copied from the team at assignment and
 * edited here. Adding and ending co-mentors and handing over are the primary's
 * (or an administrator's); for anyone else the controls stay, disabled, with
 * the reason beside them.
 */
export function CompetitionMentors({
  competition,
}: {
  readonly competition: CompetitionDetail;
}): React.JSX.Element {
  const connection = useBackendConnection();
  const write = useCompetitionWrites();
  const reasonId = useId();
  const pickId = useId();
  const [pick, setPick] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [busy, setBusy] = useState(false);
  const allowed = competition.can.manageMentors;
  const reason = allowed
    ? undefined
    : competition.can.edit || competition.allowed.length > 0
      ? 'Only the competition’s primary mentor or an administrator can change its mentors.'
      : 'This competition is closed; its mentors stay as they were.';
  const professors = useQuery({
    queryKey: ['professors'],
    queryFn: () => listProfessors(connection),
    enabled: allowed,
  });
  const taken = new Set(competition.mentors.map((mentor) => mentor.userId));
  const candidates = (professors.data ?? []).filter((person) => !taken.has(person.userId));
  const name = whoOf(competition);

  return (
    <section aria-labelledby="competition-mentors-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="competition-mentors-heading" className="text-md">
          Mentors
        </h2>
        <button
          type="button"
          disabled={!allowed}
          aria-describedby={reason === undefined ? undefined : reasonId}
          onClick={() => {
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
      <ul aria-label="Competition mentors" className="flex flex-col gap-1.5">
        {competition.mentors.map((mentor) => {
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
                  disabled={!allowed}
                  onClick={() => {
                    void write({
                      competition,
                      failure: `${mentor.displayName} is still a mentor`,
                      call: (version) =>
                        endCompetitionMentor(connection, competition.id, mentor.id, version),
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
          void write({
            competition,
            failure: 'The co-mentor was not added',
            call: (version) => addCompetitionMentor(connection, competition.id, pick, version),
          }).then(() => {
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
            disabled={!allowed}
            onChange={(event) => {
              setPick(event.target.value);
            }}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">Choose a professor</option>
            {candidates.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!allowed || pick === ''}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
        >
          <UserPlus aria-hidden="true" className="size-4" />
          Add co-mentor
        </button>
      </form>
      {competition.pastMentors.length > 0 && (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">
            Earlier mentors ({competition.pastMentors.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {competition.pastMentors.map((mentor) => (
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
          team={{ name, mentors: competition.mentors }}
          professors={professors.data ?? []}
          busy={busy}
          error={undefined}
          onCancel={() => {
            setTransferring(false);
          }}
          onTransfer={(toUserId, stepAway) => {
            setBusy(true);
            void write({
              competition,
              failure: 'The competition was not handed over',
              call: (version) =>
                transferCompetitionPrimary(connection, competition.id, {
                  toUserId,
                  stepAway,
                  version,
                }),
            }).then(() => {
              setBusy(false);
              setTransferring(false);
            });
          }}
        />
      )}
    </section>
  );
}
