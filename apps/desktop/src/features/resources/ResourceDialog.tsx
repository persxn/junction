import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  RESOURCE_LABEL_MAX,
  RESOURCE_URI_MAX,
  type Resource,
  type ResourceKind,
} from '@compintel/contracts';
import { FileSearch, FolderSearch } from 'lucide-react';
import { useId, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';
import { pickResourceFile, pickResourceFolder } from '../../shell/paths.js';

/**
 * Adding or editing a resource (WP-20b, §13): paste a link or a path, or —
 * in the desktop app — choose a file or folder, whose path is all that is
 * kept (nothing is read or copied, D-12). The kind is detected unless the
 * person picks one; the server decides and says why when it refuses.
 */

export interface ResourceDraft {
  readonly uri: string;
  readonly kind: ResourceKind | undefined;
  readonly label: string | undefined;
}

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

export function ResourceDialog({
  title,
  initial,
  shell,
  onSubmit,
  onClose,
}: {
  readonly title: string;
  readonly initial?: Resource;
  readonly shell: boolean;
  /** Resolves to a refusal to show, or undefined when it was saved. */
  readonly onSubmit: (draft: ResourceDraft) => Promise<string | undefined>;
  readonly onClose: () => void;
}): React.JSX.Element {
  const id = useId();
  const [uri, setUri] = useState(initial?.uri ?? '');
  const [kind, setKind] = useState<ResourceKind | ''>(initial?.kind ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const choose = (pick: () => Promise<string | undefined>): void => {
    void pick().then(
      (path) => {
        if (path !== undefined) {
          setUri(path);
          setKind('LOCAL_PATH');
        }
      },
      (cause: unknown) => {
        setError(`The picker did not open: ${String(cause)}`);
      },
    );
  };

  return (
    <Dialog title={title} onClose={onClose} width="max-w-lg">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(undefined);
          void onSubmit({
            uri: uri.trim(),
            kind: kind === '' ? undefined : kind,
            label: label.trim() === '' ? undefined : label.trim(),
          }).then((refusal) => {
            setBusy(false);
            if (refusal === undefined) onClose();
            else setError(refusal);
          });
        }}
      >
        <label htmlFor={`${id}-uri`} className="flex flex-col gap-0.5 text-sm">
          Link or path
          <input
            id={`${id}-uri`}
            value={uri}
            maxLength={RESOURCE_URI_MAX}
            placeholder="https://… or C:\…"
            onChange={(event) => {
              setUri(event.target.value);
            }}
            className={FIELD}
          />
        </label>
        {shell && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                choose(pickResourceFile);
              }}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
            >
              <FileSearch aria-hidden="true" className="size-4" />
              Choose file…
            </button>
            <button
              type="button"
              onClick={() => {
                choose(pickResourceFolder);
              }}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
            >
              <FolderSearch aria-hidden="true" className="size-4" />
              Choose folder…
            </button>
          </div>
        )}
        <label htmlFor={`${id}-kind`} className="flex flex-col gap-0.5 text-sm">
          Kind
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ResourceKind | '');
            }}
            className={FIELD}
          >
            <option value="">Work it out from the text</option>
            {RESOURCE_KINDS.map((value) => (
              <option key={value} value={value}>
                {RESOURCE_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-label`} className="flex flex-col gap-0.5 text-sm">
          Label (optional)
          <input
            id={`${id}-label`}
            value={label}
            maxLength={RESOURCE_LABEL_MAX}
            placeholder="Taken from the link or the file name"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            className={FIELD}
          />
        </label>
        <p className="text-xs text-fg-muted">
          Only the link or path is kept — Junction never copies or reads the file.
        </p>
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
            disabled={busy || uri.trim() === ''}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {initial === undefined ? 'Add' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
