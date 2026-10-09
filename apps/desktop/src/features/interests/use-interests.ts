import type { EventQueryInput, MyInterestsUpdate, MyInterestsView } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { isApiProblem } from '../../api/problem.js';
import {
  getInterests,
  INTERESTS_KEY,
  putInterests,
  setCategoryInterest,
} from '../../api/saved-searches.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';

/**
 * "My interests" (WP-24, R113): one query, and changes that write the whole
 * set or one category. Interests only change RELEVANCE, so every cached
 * RELEVANCE list — Discover's Recommended, the Dashboard panel, a text search
 * — is invalidated on any change, and nothing else is.
 */

/** Whether a cached query is a RELEVANCE event list (`eventListKey`). */
export function isRelevanceList(key: readonly unknown[]): boolean {
  if (key[0] !== 'events' || key[1] !== 'list') return false;
  const query = key[2] as EventQueryInput | undefined;
  return query?.sort === 'RELEVANCE';
}

export function invalidateRelevance(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: (query) => isRelevanceList(query.queryKey) });
}

export function hasInterests(view: MyInterestsView | undefined): boolean {
  return view !== undefined && (view.categoryIds.length > 0 || view.tagIds.length > 0);
}

export interface InterestsApi {
  readonly view: MyInterestsView | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly replace: (update: MyInterestsUpdate) => Promise<MyInterestsView>;
  readonly setCategory: (categoryId: string, on: boolean) => Promise<MyInterestsView>;
}

export function useInterests(): InterestsApi {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: INTERESTS_KEY, queryFn: () => getInterests(connection) });
  const settle = (view: MyInterestsView): MyInterestsView => {
    client.setQueryData(INTERESTS_KEY, view);
    void invalidateRelevance(client);
    return view;
  };
  const failed = (error: unknown): never => {
    toast.show({
      tone: 'danger',
      title: 'Could not change your interests',
      description: isApiProblem(error) ? (error.detail ?? error.title) : 'Please try again.',
    });
    throw error;
  };
  const replace = useMutation({
    mutationFn: (update: MyInterestsUpdate) => putInterests(connection, update),
  });
  const category = useMutation({
    mutationFn: (input: { id: string; on: boolean }) =>
      setCategoryInterest(connection, input.id, input.on),
  });
  return {
    view: query.data,
    isPending: query.isPending,
    error: query.error,
    replace: (update) => replace.mutateAsync(update).then(settle, failed),
    setCategory: (id, on) => category.mutateAsync({ id, on }).then(settle, failed),
  };
}
