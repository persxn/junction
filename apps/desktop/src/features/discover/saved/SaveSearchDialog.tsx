import { SAVED_SEARCH_NAME_MAX } from '@compintel/contracts';
import { useId, useState } from 'react';

import { isApiProblem } from '../../../api/problem.js';
import { Dialog } from '../../../components/Dialog.js';

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

export interface SaveSearchDialogProps {
  /** "Save this search" or "Rename saved search". */
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName?: string;
  /** The filters in words, so the person sees what is being saved. */
  readonly summary?: readonly string[];
  /** Shown only when saving: renaming does not touch the alerts. */
  readonly askAlerts: boolean;
  readonly onSubmit: (name: string, notifyOnNew: boolean) => Promise<unknown>;
  readonly onClose: () => void;
}

/**
 * Names a saved search (WP-24 step 6): a name, and "Tell me about new matches"
 * on by default. The server's refusal ("you already have a search with that
 * name") is shown in the dialog, which stays open.
 */
export function SaveSearchDialog({
  title,
  submitLabel,
  initialName = '',
  summary,
  askAlerts,
  onSubmit,
  onClose,
}: SaveSearchDialogProps): React.JSX.Element {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [alerts, setAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const trimmed = name.trim();

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed === '' || busy) return;
          setBusy(true);
          setError(undefined);
          onSubmit(trimmed, alerts).then(onClose, (cause: unknown) => {
            setBusy(false);
            setError(
              isApiProblem(cause)
                ? (cause.detail ?? cause.title)
                : 'Could not save the search. Please try again.',
            );
          });
        }}
      >
        <label htmlFor={`${id}-name`} className="flex flex-col gap-0.5 text-sm">
          Name
          <input
            id={`${id}-name`}
            value={name}
            maxLength={SAVED_SEARCH_NAME_MAX}
            required
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="AI hackathons near campus"
            className={FIELD}
          />
        </label>
        {summary !== undefined && (
          <div className="text-sm">
            <p className="text-fg-muted">Filters</p>
            {summary.length === 0 ? (
              <p>Every event (no filters chosen)</p>
            ) : (
              <ul className="list-disc pl-5">
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {askAlerts && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={alerts}
              onChange={(event) => {
                setAlerts(event.target.checked);
              }}
              className="mt-0.5"
            />
            <span>
              Tell me about new matches
              <span className="block text-xs text-fg-muted">
                Events already matching are not announced — only ones found from now on.
              </span>
            </span>
          </label>
        )}
        {error !== undefined && (
          <p role="alert" className="rounded-md bg-danger-surface p-2 text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={trimmed === '' || busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
