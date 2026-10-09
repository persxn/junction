import type { SavedSearch, SavedSearchPatchInput } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isApiProblem } from '../../../api/problem.js';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  patchSavedSearch,
  SAVED_SEARCHES_KEY,
} from '../../../api/saved-searches.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { filtersOfSaved, savedQueryOf, type FilterQuery } from '../query.js';

/**
 * A person's saved searches (WP-24, R112): the list, and every change to it
 * with its toast. Saving and "Update with current filters" re-baseline on the
 * server — nothing already matching is announced — which the toasts say.
 */

export interface SavedSearchActions {
  readonly items: readonly SavedSearch[];
  readonly isPending: boolean;
  readonly error: unknown;
  /** Resolves to the new search, or rejects with the problem (the dialog shows it). */
  readonly save: (name: string, filters: FilterQuery, notifyOnNew: boolean) => Promise<SavedSearch>;
  readonly rename: (search: SavedSearch, name: string) => Promise<SavedSearch>;
  readonly setAlerts: (search: SavedSearch, on: boolean) => void;
  readonly updateQuery: (search: SavedSearch, filters: FilterQuery) => void;
  readonly remove: (search: SavedSearch) => void;
}

const problemText = (error: unknown, fallback: string): string =>
  isApiProblem(error) ? (error.detail ?? error.title) : fallback;

export function useSavedSearches(): SavedSearchActions {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: SAVED_SEARCHES_KEY,
    queryFn: () => listSavedSearches(connection),
  });
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });
  };

  const create = useMutation({
    mutationFn: (input: { name: string; filters: FilterQuery; notifyOnNew: boolean }) =>
      createSavedSearch(connection, {
        name: input.name,
        query: savedQueryOf(input.filters),
        notifyOnNew: input.notifyOnNew,
      }),
    onSettled: refresh,
  });
  const patch = useMutation({
    mutationFn: (input: { id: string; body: SavedSearchPatchInput }) =>
      patchSavedSearch(connection, input.id, input.body),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (search: SavedSearch) => deleteSavedSearch(connection, search.id, search.version),
    onSettled: refresh,
  });

  const failed = (title: string) => (error: unknown) => {
    toast.show({ tone: 'danger', title, description: problemText(error, 'Please try again.') });
  };

  return {
    items: list.data?.items ?? [],
    isPending: list.isPending,
    error: list.error,
    save: (name, filters, notifyOnNew) => create.mutateAsync({ name, filters, notifyOnNew }),
    rename: (search, name) =>
      patch.mutateAsync({ id: search.id, body: { version: search.version, name } }),
    setAlerts: (search, on) => {
      patch.mutate(
        { id: search.id, body: { version: search.version, notifyOnNew: on } },
        {
          onSuccess: () => {
            toast.show({
              tone: 'success',
              title: on
                ? `You'll hear about new matches for “${search.name}”`
                : `Alerts off for “${search.name}”`,
            });
          },
          onError: failed('Could not change the alerts'),
        },
      );
    },
    updateQuery: (search, filters) => {
      patch.mutate(
        { id: search.id, body: { version: search.version, query: savedQueryOf(filters) } },
        {
          onSuccess: () => {
            toast.show({
              tone: 'success',
              title: `“${search.name}” now uses these filters`,
              description: 'Only events found from now on will count as new.',
            });
          },
          onError: failed('Could not update the search'),
        },
      );
    },
    remove: (search) => {
      remove.mutate(search, {
        onSuccess: () => {
          toast.show({
            title: `Deleted “${search.name}”`,
            action: {
              label: 'Undo',
              onAction: () => {
                // The search comes back with its query; what matches now is its new baseline.
                if (search.query === null) return;
                create.mutate(
                  {
                    name: search.name,
                    filters: filtersOfSaved(search.query),
                    notifyOnNew: search.notifyOnNew,
                  },
                  { onError: failed('Could not restore the search') },
                );
              },
            },
          });
        },
        onError: failed('Could not delete the search'),
      });
    },
  };
}
