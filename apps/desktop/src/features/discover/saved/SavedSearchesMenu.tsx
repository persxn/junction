import type { SavedSearch } from '@compintel/contracts';
import { Bell, BellOff, Bookmark, ChevronDown, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Popover } from '../Popover.js';
import type { FilterQuery } from '../query.js';
import { SaveSearchDialog } from './SaveSearchDialog.js';
import type { SavedSearchActions } from './use-saved-searches.js';

export interface SavedSearchesMenuProps {
  readonly searches: SavedSearchActions;
  /** What "Update with current filters" writes. */
  readonly currentFilters: FilterQuery;
  readonly onApply: (search: SavedSearch) => void;
}

const ACTION =
  'flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50';

/**
 * The Saved searches menu beside the tabs (WP-24 step 6). Each search can be
 * applied (its filters go back on the chips), updated with the current
 * filters (a silent re-baseline, R112), renamed, have its alerts turned on or
 * off, and deleted with Undo. Every control is a button in tab order, so the
 * whole menu works from the keyboard; Esc closes it.
 */
export function SavedSearchesMenu({
  searches,
  currentFilters,
  onApply,
}: SavedSearchesMenuProps): React.JSX.Element {
  const [renaming, setRenaming] = useState<SavedSearch | undefined>();
  const count = searches.items.length;
  return (
    <>
      <Popover
        label={count === 0 ? 'Saved searches' : `Saved searches (${String(count)})`}
        active={false}
        width="w-96"
        trigger={
          <>
            <Bookmark aria-hidden="true" className="size-3.5" />
            Saved searches
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </>
        }
      >
        {(close) =>
          searches.isPending ? (
            <p className="text-sm text-fg-muted">Loading your saved searches…</p>
          ) : searches.error !== null && count === 0 ? (
            <p role="alert" className="text-sm text-danger">
              Your saved searches could not be loaded.
            </p>
          ) : count === 0 ? (
            <p className="text-sm text-fg-muted">
              No saved searches yet. Choose filters, then press “Save this search”.
            </p>
          ) : (
            <ul aria-label="Saved searches" className="flex max-h-96 flex-col gap-2 overflow-auto">
              {searches.items.map((search) => (
                <li key={search.id} className="rounded-md border border-line p-2">
                  <button
                    type="button"
                    disabled={search.invalidQuery}
                    onClick={() => {
                      onApply(search);
                      close();
                    }}
                    className="w-full rounded-sm text-left font-medium text-accent hover:underline disabled:text-fg-muted disabled:no-underline"
                  >
                    {search.name}
                  </button>
                  <p className="text-xs text-fg-muted">
                    {search.invalidQuery
                      ? 'Its filters no longer work in this version — update it or delete it.'
                      : search.notifyOnNew
                        ? 'Alerts on: you hear about new matches'
                        : 'Alerts off'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        searches.updateQuery(search, currentFilters);
                        close();
                      }}
                      aria-label={`Update “${search.name}” with the current filters`}
                      className={ACTION}
                    >
                      <RefreshCw aria-hidden="true" className="size-3.5" />
                      Update with current filters
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setRenaming(search);
                      }}
                      aria-label={`Rename “${search.name}”`}
                      className={ACTION}
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-pressed={search.notifyOnNew}
                      disabled={search.invalidQuery}
                      onClick={() => {
                        searches.setAlerts(search, !search.notifyOnNew);
                      }}
                      aria-label={`Alerts for “${search.name}”`}
                      className={ACTION}
                    >
                      {search.notifyOnNew ? (
                        <Bell aria-hidden="true" className="size-3.5" />
                      ) : (
                        <BellOff aria-hidden="true" className="size-3.5" />
                      )}
                      {search.notifyOnNew ? 'Alerts on' : 'Alerts off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        searches.remove(search);
                        close();
                      }}
                      aria-label={`Delete “${search.name}”`}
                      className={`${ACTION} text-danger`}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Popover>
      {renaming !== undefined && (
        <SaveSearchDialog
          title="Rename saved search"
          submitLabel="Rename"
          initialName={renaming.name}
          askAlerts={false}
          onSubmit={(name) => searches.rename(renaming, name)}
          onClose={() => {
            setRenaming(undefined);
          }}
        />
      )}
    </>
  );
}
