import {
  EventCategoriesInput,
  EventCategoriesResult,
  EventChangePage,
  EventDetailView,
  SourceStatusResponse,
  type BackendConnection,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * The event drawer's reads and its one write (§16.2, WP-16b), plus the §16.1
 * freshness pill's source status.
 *
 * Every answer is parsed with the contract's schema: a drawer that renders
 * provenance has to be certain the provenance is the shape it thinks it is, and
 * a silent `undefined` in a "Sources disagree" panel would be exactly the kind
 * of quiet wrongness this screen exists to rule out.
 */

const eventPath = (id: string, tail: string): string =>
  `/api/v1/events/${encodeURIComponent(id)}/${tail}`;

export async function fetchEventDetail(
  connection: BackendConnection,
  id: string,
  signal?: AbortSignal,
): Promise<EventDetailView> {
  return EventDetailView.parse(
    await apiGet(connection, eventPath(id, 'detail'), signal === undefined ? {} : { signal }),
  );
}

/** "Load older" on the change history; `cursor` is the last id of the page above. */
export async function fetchEventChanges(
  connection: BackendConnection,
  id: string,
  cursor: string,
  signal?: AbortSignal,
): Promise<EventChangePage> {
  const query = `?cursor=${encodeURIComponent(cursor)}`;
  return EventChangePage.parse(
    await apiGet(
      connection,
      `${eventPath(id, 'changes')}${query}`,
      signal === undefined ? {} : { signal },
    ),
  );
}

/** D-15's override. The body is the whole intended set, with the event's `version`. */
export async function setEventCategories(
  connection: BackendConnection,
  id: string,
  input: EventCategoriesInput,
): Promise<EventCategoriesResult> {
  return EventCategoriesResult.parse(
    await apiRequest(connection, eventPath(id, 'categories'), {
      method: 'PUT',
      body: EventCategoriesInput.parse(input),
    }),
  );
}

export async function fetchSourceStatus(
  connection: BackendConnection,
  signal?: AbortSignal,
): Promise<SourceStatusResponse> {
  return SourceStatusResponse.parse(
    await apiGet(connection, '/api/v1/sources/status', signal === undefined ? {} : { signal }),
  );
}
