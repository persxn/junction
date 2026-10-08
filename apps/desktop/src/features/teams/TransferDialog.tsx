import type { MentorRole, TeamPerson } from '@compintel/contracts';
import { useId, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';

/**
 * "Hand over…" (R95's transfer primary): pick the professor who becomes the
 * primary mentor; the current primary stays on as a co-mentor unless "Step
 * away" is ticked.
 */

export interface TransferDialogProps {
  /** A team or a competition: its name and its open mentors (WP-19 reuses this dialog). */
  readonly team: {
    readonly name: string;
    readonly mentors: readonly {
      readonly userId: string;
      readonly displayName: string;
      readonly role: MentorRole;
    }[];
  };
  readonly professors: readonly TeamPerson[];
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onTransfer: (toUserId: string, stepAway: boolean) => void;
}

export function TransferDialog({
  team,
  professors,
  busy,
  error,
  onCancel,
  onTransfer,
}: TransferDialogProps): React.JSX.Element {
  const primary = team.mentors.find((mentor) => mentor.role === 'PRIMARY');
  const choices = professors.filter((person) => person.userId !== primary?.userId);
  const [to, setTo] = useState('');
  const [stepAway, setStepAway] = useState(false);
  const selectId = useId();
  const stepId = useId();
  return (
    <Dialog title={`Hand ${team.name} over`} onClose={onCancel}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (to !== '') onTransfer(to, stepAway);
        }}
      >
        <p className="text-sm text-fg-muted">
          The new primary mentor decides who else mentors it.
          {primary !== undefined && ` ${primary.displayName} is the primary mentor now.`}
        </p>
        <label htmlFor={selectId} className="text-sm font-medium">
          New primary mentor
        </label>
        <select
          id={selectId}
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
          }}
          className="rounded-md border border-line bg-surface px-2 py-1.5"
        >
          <option value="">Choose a professor</option>
          {choices.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.displayName}
            </option>
          ))}
        </select>
        <label htmlFor={stepId} className="flex items-start gap-2 text-sm">
          <input
            id={stepId}
            type="checkbox"
            checked={stepAway}
            onChange={(event) => {
              setStepAway(event.target.checked);
            }}
            className="mt-1"
          />
          <span>
            <strong>Step away</strong> — {primary?.displayName ?? 'the current primary'} stops
            mentoring this team instead of staying on as a co-mentor.
          </span>
        </label>
        {error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || to === ''}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
          >
            Hand over
          </button>
        </div>
      </form>
    </Dialog>
  );
}
