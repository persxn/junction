import type { EventQueryInput, Facets, RankedEventListItem } from '@compintel/contracts';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { searchEvents } from '../../api/search.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { flatItems, type Pages } from './cache.js';

/**
 * The Discover list's server state (§8, WP-16a step 2): one infinite query per
 * `EventQuery`, paged by the backend's cursor. The previous result stays on
 * screen while a new filter loads, so the list does not blink between queries.
 * Facets come with the first page only — a later page asks for none.
 */

export const eventListKey = (query: EventQueryInput) => ['events', 'list', query] as const;

export interface EventSearch {
  readonly items: readonly RankedEventListItem[];
  readonly total: number | undefined;
  readonly facets: Facets | undefined;
  readonly correction: string | undefined;
  readonly isPending: boolean;
  /** A new query is loading while the previous result is still shown. */
  readonly isRefreshing: boolean;
  readonly error: unknown;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

export function useEventSearch(query: EventQueryInput): EventSearch {
  const connection = useBackendConnection();
  const result = useInfiniteQuery({
    queryKey: eventListKey(query),
    queryFn: ({ pageParam, signal }) =>
      searchEvents(
        connection,
        {
          ...query,
          facets: pageParam === undefined,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
  const data = result.data as Pages | undefined;
  const first = data?.pages[0];
  return {
    items: flatItems(data),
    total: first?.total,
    facets: first?.facets,
    correction: first?.correction?.message,
    isPending: result.isPending,
    isRefreshing: result.isPlaceholderData,
    error: result.error,
    hasMore: result.hasNextPage,
    isLoadingMore: result.isFetchingNextPage,
    loadMore: () => {
      void result.fetchNextPage();
    },
    retry: () => {
      void result.refetch();
    },
  };
}
