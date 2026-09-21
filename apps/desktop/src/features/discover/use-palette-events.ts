import type { RankedEventListItem } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { searchEvents } from '../../api/search.js';
import { useBackendConnection } from '../../shell/connection-context.js';

/** How long the palette waits after the last keystroke before searching. */
export const PALETTE_DEBOUNCE_MS = 200;
/** How many events the palette shows; "See all results" goes to Discover. */
export const PALETTE_EVENT_LIMIT = 5;
/** Below this, a term matches too much to be worth a request. */
const MIN_TERM = 2;

/** `value`, once it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

export interface PaletteEvents {
  /** The term the results are for (debounced). */
  readonly term: string;
  readonly items: readonly RankedEventListItem[];
  readonly isLoading: boolean;
}

/** The palette's live event search: top 5, hidden events left out, no facets. */
export function usePaletteEvents(input: string): PaletteEvents {
  const connection = useBackendConnection();
  const term = useDebounced(input.trim(), PALETTE_DEBOUNCE_MS);
  const enabled = term.length >= MIN_TERM;
  const query = useQuery({
    queryKey: ['events', 'palette', term],
    queryFn: ({ signal }) =>
      searchEvents(
        connection,
        { text: term, limit: PALETTE_EVENT_LIMIT, facets: false, excludeHidden: true },
        signal,
      ),
    enabled,
    staleTime: 10_000,
  });
  return {
    term,
    items: enabled ? (query.data?.items ?? []) : [],
    isLoading: enabled && query.isFetching,
  };
}
