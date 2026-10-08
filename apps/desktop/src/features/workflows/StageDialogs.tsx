import { BLOCKED_REASON_MAX, type OpenTaskChoice } from '@compintel/contracts';
import { useId, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';

/**
 * The workflow's three questions (WP-20a step 7, §11): completing a stage with
 * open tasks, what blocks a stage, and whether to remove something — removals
 * confirm, they are not undone.
 */

const SECONDARY = 'rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover';
const PRIMARY =
  'rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50';

/** "Mark the remaining N tasks done?" · Yes · Complete anyway · Cancel. */
export function CompleteStageDialog({
  stageName,
  open,
  onAnswer,
}: {
  readonly stageName: string;
  readonly open: number;
  readonly onAnswer: (answer: OpenTaskChoice | undefined) => void;
}): React.JSX.Element {
  return (
    <Dialog
      title={`Complete “${stageName}”?`}
      onClose={() => {
        onAnswer(undefined);
      }}
    >
      <p className="text-sm">
        Mark the remaining {open} {open === 1 ? 'task' : 'tasks'} done?
      </p>
      <p className="text-sm text-fg-muted">
        “Complete anyway” leaves {open === 1 ? 'it' : 'them'} open and marks the stage “Completed
        with open tasks”.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={SECONDARY}
          onClick={() => {
            onAnswer(undefined);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => {
            onAnswer('KEEP');
          }}
        >
          Complete anyway
        </button>
        <button
          type="button"
          className={PRIMARY}
          onClick={() => {
            onAnswer('CLOSE');
          }}
        >
          Yes
        </button>
      </div>
    </Dialog>
  );
}

/** BLOCKED needs a reason of up to 200 characters (§11). */
export function BlockedReasonDialog({
  stageName,
  onAnswer,
}: {
  readonly stageName: string;
  readonly onAnswer: (reason: string | undefined) => void;
}): React.JSX.Element {
  const fieldId = useId();
  const [reason, setReason] = useState('');
  return (
    <Dialog
      title={`What is blocking “${stageName}”?`}
      onClose={() => {
        onAnswer(undefined);
      }}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim() !== '') onAnswer(reason.trim());
        }}
      >
        <label htmlFor={fieldId} className="text-sm">
          Reason (up to {BLOCKED_REASON_MAX} characters)
        </label>
        <input
          id={fieldId}
          value={reason}
          maxLength={BLOCKED_REASON_MAX}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={SECONDARY}
            onClick={() => {
              onAnswer(undefined);
            }}
          >
            Cancel
          </button>
          <button type="submit" className={PRIMARY} disabled={reason.trim() === ''}>
            Mark blocked
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmRemoveDialog({
  what,
  detail,
  onAnswer,
}: {
  /** "the stage “Build prototype”". */
  readonly what: string;
  readonly detail: string;
  readonly onAnswer: (remove: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog
      title={`Remove ${what}?`}
      onClose={() => {
        onAnswer(false);
      }}
    >
      <p className="text-sm">{detail} This cannot be undone.</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={SECONDARY}
          onClick={() => {
            onAnswer(false);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-md bg-danger px-3 py-1.5 font-medium text-on-accent hover:opacity-90"
          onClick={() => {
            onAnswer(true);
          }}
        >
          Remove
        </button>
      </div>
    </Dialog>
  );
}
