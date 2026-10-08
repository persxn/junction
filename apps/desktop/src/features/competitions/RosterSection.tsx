import { REMOVAL_REASON_LABELS, type CompetitionDetail } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, UserMinus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { addParticipant, removeParticipant } from '../../api/competitions.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { dayText } from '../students/labels.js';
import { StudentPicker } from '../teams/StudentPicker.js';
import { COMPETITIONS_KEY, competitionKey, problemText } from './use-competition-actions.js';
import { useCompetitionWrites } from './use-competition-writes.js';

/**
 * The roster (R97): frozen at assignment, edited only here. Adding a student
 * already taking part in this event elsewhere shows the server's sentence
 * inline ("already in Team Rocket — HackXYZ 2026 for this event"); removing
 * is optimistic, with Undo re-adding the same student and role.
 */
export function RosterSection({
  competition,
  reason,
}: {
  readonly competition: CompetitionDetail;
  /** Why the roster cannot be edited, or undefined when it can. */
  readonly reason: string | undefined;
}): React.JSX.Element {
  const connection = useBackendConnection();
  const write = useCompetitionWrites();
  const toast = useToast();
  const client = useQueryClient();
  const [inline, setInline] = useState<string | undefined>(undefined);
  const exclude = useMemo(
    () => new Set(competition.roster.map((entry) => entry.studentId)),
    [competition.roster],
  );

  /** The server's answer becomes the page; an A14 refusal is shown inline, not as a toast. */
  const add = (studentId: string, roleLabel: string | null, base: CompetitionDetail): void => {
    setInline(undefined);
    addParticipant(connection, base.id, { studentId, roleLabel, version: base.version }).then(
      (saved) => {
        client.setQueryData(competitionKey(saved.id), saved);
        void client.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
      },
      (cause: unknown) => {
        setInline(problemText(cause));
      },
    );
  };

  return (
    <section aria-labelledby="roster-heading" className="flex flex-col gap-3">
      <h2 id="roster-heading" className="text-md">
        Roster ({competition.roster.length})
      </h2>
      <p className="text-sm text-fg-muted">
        Copied from the team when it was assigned. Changes to the team afterwards do not change it.
      </p>
      {competition.roster.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody is on the roster.</p>
      ) : (
        <ul aria-label="Roster" className="flex flex-col">
          {competition.roster.map((entry) => (
            <li
              key={entry.studentId}
              className="flex flex-wrap items-center gap-x-3 border-b border-line py-2 text-sm"
            >
              <Link
                to="/students/$studentId"
                params={{ studentId: entry.studentId }}
                className="font-medium hover:underline"
              >
                {entry.fullName}
              </Link>
              <span className="font-mono text-fg-muted">{entry.universityId}</span>
              <span className="text-fg-muted">{entry.roleLabel ?? 'No role set'}</span>
              <button
                type="button"
                disabled={reason !== undefined}
                onClick={() => {
                  void write({
                    competition,
                    failure: `${entry.fullName} was not removed`,
                    call: (version) =>
                      removeParticipant(connection, competition.id, entry.studentId, version),
                    optimistic: (current) => ({
                      ...current,
                      roster: current.roster.filter((row) => row.studentId !== entry.studentId),
                    }),
                  }).then((saved) => {
                    if (saved === undefined) return;
                    toast.show({
                      tone: 'info',
                      title: `${entry.fullName} is off the roster`,
                      action: {
                        label: 'Undo',
                        onAction: () => {
                          const latest =
                            client.getQueryData<CompetitionDetail>(competitionKey(saved.id)) ??
                            saved;
                          add(entry.studentId, entry.roleLabel, latest);
                        },
                      },
                    });
                  });
                }}
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-hover disabled:opacity-50"
              >
                <UserMinus aria-hidden="true" className="size-3.5" />
                Remove {entry.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="max-w-md">
        <StudentPicker
          label="Add to the roster"
          exclude={exclude}
          disabled={reason !== undefined}
          onPick={(student) => {
            add(student.id, null, competition);
          }}
        />
      </div>
      {inline !== undefined && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {inline}
        </p>
      )}
      {competition.pastRoster.length > 0 && (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">
            Earlier on the roster ({competition.pastRoster.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {competition.pastRoster.map((entry) => (
              <li key={entry.studentId}>
                {entry.fullName}, {dayText(entry.addedAt)} –{' '}
                {dayText(entry.removedAt ?? entry.addedAt)}
                {entry.removalReason !== null && ` · ${REMOVAL_REASON_LABELS[entry.removalReason]}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
