import type { Facets } from '@compintel/contracts';
import { BookmarkPlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useToast } from '../../../components/toast/ToastProvider.js';
import { CHIP_ORDER, chipLabel, type FilterQuery } from '../query.js';
import { SaveSearchDialog } from './SaveSearchDialog.js';
import type { SavedSearchActions } from './use-saved-searches.js';

export interface SaveSearchButtonProps {
  readonly searches: SavedSearchActions;
  /** What is saved: the chips with the tab's defining filters folded in (`filtersToSave`). */
  readonly filters: FilterQuery;
  readonly facets: Facets | undefined;
}

/** The filters in words, as the chips say them — the dialog's summary. */
export function describeFilters(
  filters: FilterQuery,
  categoryNames: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [];
  if (filters.text !== undefined && filters.text.trim() !== '') {
    lines.push(`Text: “${filters.text.trim()}”`);
  }
  for (const id of CHIP_ORDER) {
    const label = chipLabel(filters, id, categoryNames);
    if (label !== undefined) lines.push(label);
  }
  return lines;
}

/** "Save this search" beside the chips (WP-24 step 6). */
export function SaveSearchButton({
  searches,
  filters,
  facets,
}: SaveSearchButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const categoryNames = useMemo(
    () => new Map((facets?.category ?? []).map((entry) => [entry.value, entry.label])),
    [facets],
  );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-sm hover:bg-surface-hover"
      >
        <BookmarkPlus aria-hidden="true" className="size-3.5" />
        Save this search
      </button>
      {open && (
        <SaveSearchDialog
          title="Save this search"
          submitLabel="Save"
          summary={describeFilters(filters, categoryNames)}
          askAlerts
          onSubmit={async (name, notifyOnNew) => {
            const saved = await searches.save(name, filters, notifyOnNew);
            toast.show({
              tone: 'success',
              title: `Saved “${saved.name}”`,
              description: saved.notifyOnNew
                ? 'You will be told when new events match it.'
                : 'Find it under Saved searches.',
            });
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
