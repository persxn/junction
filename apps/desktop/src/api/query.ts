import { QueryClient } from '@tanstack/react-query';

import { isApiProblem } from './problem.js';

/**
 * Server state lives in TanStack Query; component state does not (§4.2).
 *
 * ## Query-key convention
 *
 * A key is always `[domain, scope, ...discriminators]`, read left to right from
 * the broadest thing to the narrowest, because that is exactly how invalidation
 * works: `invalidateQueries({ queryKey: ['events'] })` drops every event query,
 * `['events', 'list']` drops the lists but keeps the details, and
 * `['events', 'detail', id]` drops one row.
 *
 *   ['health']                        the backend health probe
 *   ['events', 'list', filters]       a filtered list; `filters` is the query object
 *   ['events', 'detail', eventId]     one aggregate
 *   ['teams', 'list']                 …and so on for every later domain
 *
 * Rules that go with it:
 *   - the domain segment is the API path segment (`events`, `teams`, `sources`),
 *     so a key can always be traced back to an endpoint;
 *   - a mutation invalidates the **broadest** key it could have affected, rather
 *     than trying to guess which lists changed;
 *   - nothing derived goes in a key. If it is computable from the data, compute
 *     it in a selector, or two screens will disagree about the same row.
 *
 * WP-07a adds SSE-driven invalidation on top of this: a stream event names a
 * domain, and the handler invalidates that domain's key. Until then, and whenever
 * the stream is unavailable (ruling R30), the staleness below is what refreshes.
 */
export const queryKeys = {
  /** `GET /api/v1/health`; the only endpoint that exists today. */
  health: () => ['health'] as const,
} as const;

/**
 * Retry policy. A `problem+json` answer already says whether repeating the
 * request could help (ruling R5), so the client does not second-guess it: 4xx
 * answers — a bad request, a missing row, a stale `version` — are not retried,
 * because nothing about the second attempt would be different. A 409 in
 * particular must reach the caller: re-sending it would re-submit a write that
 * was already made against a stale copy (§4.4).
 *
 * Anything that is not an `ApiProblem` escaped the client and is a bug, not a
 * network blip; retrying it would only hide it.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!isApiProblem(error)) {
    return false;
  }
  return error.retryable && failureCount < 2;
}

/**
 * One client for the app. The defaults suit a local backend: data is a
 * millisecond away, but it is also a single SQLite file being scraped into, so
 * re-reading on every focus change would be noise rather than freshness.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
        // The window is the app; focusing it does not mean the data moved.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        // A write is never replayed automatically: the caller decides, because
        // only the caller knows whether the write was idempotent.
        retry: false,
      },
    },
  });
}
