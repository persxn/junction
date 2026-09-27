import type { SourceStatusResponse } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';

import { fetchSourceStatus, SOURCE_STATUS_KEY } from '../../api/event-detail.js';
import { useBackendConnection } from '../../shell/connection-context.js';

/**
 * `GET /sources/status` for the §16.1 freshness pill.
 *
 * **The stream drives it; the poll is only the fallback** (rulings R86 and R30).
 * Every finished scrape run now publishes `source.run.finished`, and
 * `use-live-updates.ts` invalidates this query's key when one arrives — so the
 * pill moves within one event of a run ending instead of lagging by up to a
 * minute, which is exactly the way a freshness indicator must not be wrong.
 *
 * The poll stays, at five minutes rather than one. It is what R30 asks for on a
 * machine where the WebView cannot hold a stream at all, and it also covers the
 * one thing no event can: "last read 4 minutes ago" becoming "5 minutes ago"
 * while nothing whatever happens.
 */

export { SOURCE_STATUS_KEY };

/** R86's fallback interval: five minutes, not one. */
export const SOURCE_STATUS_REFETCH_MS = 5 * 60_000;

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
