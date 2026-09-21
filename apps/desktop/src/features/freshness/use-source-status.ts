import type { SourceStatusResponse } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';

import { fetchSourceStatus } from '../../api/event-detail.js';
import { useBackendConnection } from '../../shell/connection-context.js';

/**
 * `GET /sources/status` for the §16.1 freshness pill.
 *
 * **It refetches every 60 seconds rather than riding the SSE stream.** The
 * stream only invalidates what a publisher tells it to, and WP-09a's scrape
 * runs publish nothing — no `job.progress`, no `data.invalidated` for sources —
 * so a stream-driven pill would sit at "Updated 4 min ago" for an hour and be
 * wrong in exactly the way a freshness indicator must never be. A 60 s poll of
 * one small local query costs nothing and is honest. When WP-30's health
 * surface starts publishing scrape events, this query's key is what it
 * invalidates and the interval can go.
 */

export const SOURCE_STATUS_KEY = ['sources', 'status'] as const;
export const SOURCE_STATUS_REFETCH_MS = 60_000;

export interface SourceStatusView {
  readonly data: SourceStatusResponse | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
}

export function useSourceStatus(refetchIntervalMs = SOURCE_STATUS_REFETCH_MS): SourceStatusView {
  const connection = useBackendConnection();
  const result = useQuery({
    queryKey: SOURCE_STATUS_KEY,
    queryFn: ({ signal }) => fetchSourceStatus(connection, signal),
    refetchInterval: refetchIntervalMs,
    staleTime: refetchIntervalMs,
  });
  return { data: result.data, isPending: result.isPending, error: result.error };
}
