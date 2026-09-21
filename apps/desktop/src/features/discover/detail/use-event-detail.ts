import type { EventChangeDto, EventDetailView } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import {
  fetchEventChanges,
  fetchEventDetail,
  setEventCategories,
} from '../../../api/event-detail.js';
import { isApiProblem } from '../../../api/problem.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';

/**
 * The drawer's server state (§16.2, WP-16b).
 *
 * One query per event — `['events', 'detail', id]`, the key convention
 * `api/query.ts` fixes — so the whole drawer arrives together. "Load older" on
 * the change history is the only thing that pages, and it appends to local
 * state rather than to the cache: it is a view of history, not a second source
 * of truth, and a refetch should start it over from the top.
 */

export const eventDetailKey = (id: string) => ['events', 'detail', id] as const;

export interface EventDetail {
  readonly data: EventDetailView | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly retry: () => void;
  /** The first page plus every "load older" page, newest first. */
  readonly history: readonly EventChangeDto[];
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlder: () => void;
}

export function useEventDetail(eventId: string): EventDetail {
  const connection = useBackendConnection();
  const [older, setOlder] = useState<{
    id: string;
    items: EventChangeDto[];
    cursor: string | null;
  }>({ id: eventId, items: [], cursor: null });
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const toast = useToast();

  const result = useQuery({
    queryKey: eventDetailKey(eventId),
    queryFn: ({ signal }) => fetchEventDetail(connection, eventId, signal),
  });

  // A different event, or a refetch, starts the history over.
  const fresh = older.id === eventId ? older : { id: eventId, items: [], cursor: null };
  const cursor = fresh.cursor ?? result.data?.history.nextCursor ?? null;

  const loadOlder = useCallback((): void => {
    if (cursor === null || isLoadingOlder) return;
    setLoadingOlder(true);
    void fetchEventChanges(connection, eventId, cursor)
      .then((page) => {
        setOlder((previous) => ({
          id: eventId,
          items: [...(previous.id === eventId ? previous.items : []), ...page.items],
          cursor: page.nextCursor,
        }));
      })
      .catch((cause: unknown) => {
        toast.show({
          tone: 'danger',
          title: 'Could not load older changes',
          description: isApiProblem(cause)
            ? (cause.detail ?? cause.title)
            : 'The local service did not answer.',
        });
      })
      .finally(() => {
        setLoadingOlder(false);
      });
  }, [connection, cursor, eventId, isLoadingOlder, toast]);

  return {
    data: result.data,
    isPending: result.isPending,
    error: result.error,
    retry: () => {
      setOlder({ id: eventId, items: [], cursor: null });
      void result.refetch();
    },
    history: [...(result.data?.history.items ?? []), ...fresh.items],
    hasOlder: cursor !== null,
    isLoadingOlder,
    loadOlder,
  };
}

export interface CategoryOverride {
  readonly save: (categoryIds: readonly string[]) => void;
  readonly isSaving: boolean;
}

/**
 * The category override (D-15), optimistic with Undo (§16.3).
 *
 * The chips change the moment they are clicked and the request follows; a
 * failure puts the cache back and says what happened. Undo sends the previous
 * set, which is the same call in the other direction — there is no "unset"
 * verb, because the body is always the whole intended set.
 */
export function useCategoryOverride(eventId: string): CategoryOverride {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (input: { categoryIds: readonly string[]; version: number }) =>
      setEventCategories(connection, eventId, {
        categoryIds: [...input.categoryIds],
        version: input.version,
      }),
    onSuccess: (result) => {
      client.setQueryData<EventDetailView>(eventDetailKey(eventId), (previous) =>
        previous === undefined
          ? previous
          : { ...previous, categories: result.categories, version: result.version },
      );
      // The lists show no categories, but a suppression can change ranking.
      void client.invalidateQueries({ queryKey: ['events', 'list'] });
    },
    onError: (cause: unknown) => {
      void client.invalidateQueries({ queryKey: eventDetailKey(eventId) });
      toast.show({
        tone: 'danger',
        title: 'Could not change the categories',
        description: isApiProblem(cause)
          ? (cause.detail ?? cause.title)
          : 'The local service did not answer.',
      });
    },
  });

  const save = useCallback(
    (categoryIds: readonly string[]): void => {
      const current = client.getQueryData<EventDetailView>(eventDetailKey(eventId));
      if (current === undefined) return;
      const before = current.categories
        .filter((category) => !category.isSuppressed)
        .map((category) => category.id);
      client.setQueryData<EventDetailView>(eventDetailKey(eventId), {
        ...current,
        categories: current.categories.map((category) => ({
          ...category,
          origin: categoryIds.includes(category.id) ? 'MANUAL' : category.origin,
          isSuppressed: !categoryIds.includes(category.id),
        })),
      });
      mutation.mutate(
        { categoryIds, version: current.version },
        {
          onSuccess: (result) => {
            toast.show({
              tone: 'success',
              title: 'Categories updated',
              description: 'Your choice stays put when the rules change.',
              action: {
                label: 'Undo',
                onAction: () => {
                  mutation.mutate({ categoryIds: before, version: result.version });
                },
              },
            });
          },
        },
      );
    },
    [client, eventId, mutation, toast],
  );

  return { save, isSaving: mutation.isPending };
}
