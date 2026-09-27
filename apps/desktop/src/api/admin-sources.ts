import {
  SourceConnectPrompt,
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

/** The query key for the answer below; the gate and the reopen button share it. */
export const CONNECT_PROMPT_KEY = ['sources', 'connect-prompt'] as const;

/**
 * Whether R74's one-time "Connect your sources" step is still owed. Readable by
 * anyone signed in, because the gate has to decide before it knows what the
 * account may do.
 */
export async function fetchConnectPrompt(
  connection: BackendConnection,
): Promise<SourceConnectPrompt> {
  return SourceConnectPrompt.parse(await apiGet(connection, '/api/v1/sources/connect-prompt'));
}

/** "I have signed in" or "Skip for now" — both close it for good (`source.manage`). */
export async function markConnectPromptSeen(
  connection: BackendConnection,
): Promise<SourceConnectPrompt> {
  return SourceConnectPrompt.parse(
    await apiRequest(connection, '/api/v1/admin/sources/connect-prompt/seen', { method: 'POST' }),
  );
}
