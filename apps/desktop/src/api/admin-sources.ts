import {
  SourceListResponse,
  SourceSessionStatus,
  type BackendConnection,
  type SourceSummary,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * `/sources` and the session routes of `/admin/sources` (§10.2 `source.manage`,
 * R74/D-34).
 *
 * Nothing here ever carries a cookie back: `GET` answers state, `PUT` takes one
 * and answers state, `DELETE` removes it and answers state.
 */

export async function listSources(
  connection: BackendConnection,
): Promise<readonly SourceSummary[]> {
  return SourceListResponse.parse(await apiGet(connection, '/api/v1/sources')).sources;
}

export async function getSourceSession(
  connection: BackendConnection,
  key: string,
): Promise<SourceSessionStatus> {
  return SourceSessionStatus.parse(
    await apiGet(connection, `/api/v1/admin/sources/${key}/session`),
  );
}

export async function setSourceSession(
  connection: BackendConnection,
  key: string,
  cookie: string,
  capturedVia: 'PASTE' | 'LOGIN_WINDOW',
): Promise<SourceSessionStatus> {
  return SourceSessionStatus.parse(
    await apiRequest(connection, `/api/v1/admin/sources/${key}/session`, {
      method: 'PUT',
      body: { cookie, capturedVia },
    }),
  );
}

export async function clearSourceSession(
  connection: BackendConnection,
  key: string,
): Promise<SourceSessionStatus> {
  return SourceSessionStatus.parse(
    await apiRequest(connection, `/api/v1/admin/sources/${key}/session`, { method: 'DELETE' }),
  );
}
