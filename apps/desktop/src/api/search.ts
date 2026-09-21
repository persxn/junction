import {
  EventUserState,
  SearchRequest,
  SearchResponse,
  WatchlistEntry,
  type BackendConnection,
  type SearchRequestInput,
} from '@compintel/contracts';

import { apiRequest } from './client.js';

/**
 * Search and a professor's own Save/Hide (§8, §10.2, WP-15a/15b/16a).
 *
 * The request is zod-parsed **before** it is sent: the UI never invents a query
 * shape (§8.1), so a filter the contract cannot express fails here, in the
 * developer's face, rather than as a 400 in the professor's.
 */

export async function searchEvents(
  connection: BackendConnection,
  request: SearchRequestInput,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const body = SearchRequest.parse(request);
  return SearchResponse.parse(
    await apiRequest(connection, '/api/v1/search/events', {
      method: 'POST',
      body,
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

const eventPath = (id: string, tail: string): string =>
  `/api/v1/events/${encodeURIComponent(id)}/${tail}`;

export async function saveEvent(
  connection: BackendConnection,
  id: string,
): Promise<WatchlistEntry> {
  return WatchlistEntry.parse(
    await apiRequest(connection, eventPath(id, 'watchlist'), { method: 'PUT', body: {} }),
  );
}

export async function unsaveEvent(connection: BackendConnection, id: string): Promise<void> {
  await apiRequest(connection, eventPath(id, 'watchlist'), { method: 'DELETE' });
}

export async function hideEvent(
  connection: BackendConnection,
  id: string,
): Promise<EventUserState> {
  return EventUserState.parse(
    await apiRequest(connection, eventPath(id, 'hide'), { method: 'POST', body: {} }),
  );
}

export async function unhideEvent(
  connection: BackendConnection,
  id: string,
): Promise<EventUserState> {
  return EventUserState.parse(
    await apiRequest(connection, eventPath(id, 'unhide'), { method: 'POST', body: {} }),
  );
}
