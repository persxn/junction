import {
  EventImportResult,
  UrlImportResult,
  type BackendConnection,
  type ManualEventInput,
  type UrlImportCommitRequest,
} from '@compintel/contracts';

import { apiRequest } from './client.js';

/**
 * Manual event creation and URL import (§10.2, D-30, WP-14).
 *
 * The preview is a POST although it only reads: the pasted link is user data
 * with no business in a URL, a log line or a window history, and it is not
 * idempotent from the site's point of view either — it fetches their page.
 */

export async function createManualEvent(
  connection: BackendConnection,
  input: ManualEventInput,
): Promise<EventImportResult> {
  return EventImportResult.parse(
    await apiRequest(connection, '/api/v1/events', { method: 'POST', body: input }),
  );
}

export async function previewImport(
  connection: BackendConnection,
  url: string,
): Promise<UrlImportResult> {
  return UrlImportResult.parse(
    await apiRequest(connection, '/api/v1/events/import/preview', {
      method: 'POST',
      body: { url },
    }),
  );
}

export async function commitImport(
  connection: BackendConnection,
  request: UrlImportCommitRequest,
): Promise<EventImportResult> {
  return EventImportResult.parse(
    await apiRequest(connection, '/api/v1/events/import/commit', {
      method: 'POST',
      body: request,
    }),
  );
}
