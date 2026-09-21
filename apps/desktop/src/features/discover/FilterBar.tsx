import type { Facets } from '@compintel/contracts';
import { ChevronDown, X } from 'lucide-react';
import { useMemo } from 'react';

import { ChipEditor } from './ChipEditor.js';
import { Popover } from './Popover.js';
import {
  CHIP_NAMES,
  CHIP_ORDER,
  chipLabel,
  clearChips,
  hasChips,
  type FilterQuery,
} from './query.js';

export interface FilterBarProps {
  readonly filters: FilterQuery;
  readonly facets: Facets | undefined;
  readonly onChange: (filters: FilterQuery) => void;
}

/**
 * The filter-chip bar (WP-16a step 4). A chip that is set shows its value in
 * words — "Within 300 km (in person)", concrete dates — and opens its editor;
 * "Clear all" resets every chip but leaves the search text alone.
 */
export function FilterBar({ filters, facets, onChange }: FilterBarProps): React.JSX.Element {
  const categoryNames = useMemo(
    () => new Map((facets?.category ?? []).map((entry) => [entry.value, entry.label])),
    [facets],
  );
  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      {CHIP_ORDER.map((id) => {
        const label = chipLabel(filters, id, categoryNames);
        const name = CHIP_NAMES[id];
        return (
          <Popover
            key={id}
            label={label === undefined ? `${name} filter` : `${name} filter: ${label}`}
            active={label !== undefined}
            trigger={
              <>
                {label ?? name}
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </>
            }
          >
            <ChipEditor id={id} filters={filters} facets={facets} onChange={onChange} />
          </Popover>
        );
      })}
      {hasChips(filters) && (
        <button
          type="button"
          onClick={() => {
            onChange(clearChips(filters));
          }}
          className="flex items-center gap-1 rounded-full px-3 py-1 text-sm text-fg-muted hover:bg-surface-hover"
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear all
        </button>
      )}
    </div>
  );
}
