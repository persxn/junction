import {
  LoginResponse,
  MeResponse,
  PermissionsResponse,
  SessionResponse,
  type BackendConnection,
  type ClientKind,
  type LoginResponse as Login,
  type MeResponse as Me,
  type PermissionsResponse as Permissions,
  type SessionResponse as Session,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * The `/auth` and `/me` calls, typed (§4.12, ADR-0010).
 *
 * Every response is parsed against the contract before it reaches a component,
 * the same rule the shell IPC follows: the UI should fail loudly on a shape
 * change, not render `undefined` where a name should be.
 */

export async function login(
  connection: BackendConnection,
  email: string,
  password: string,
  clientKind: ClientKind = 'DESKTOP',
): Promise<Login> {
  return LoginResponse.parse(
    await apiRequest(connection, '/api/v1/auth/login', {
      method: 'POST',
      body: { email, password, clientKind },
    }),
  );
}

export async function logout(connection: BackendConnection): Promise<Session> {
  return SessionResponse.parse(
    await apiRequest(connection, '/api/v1/auth/logout', { method: 'POST' }),
  );
}

/** Ruling R37: extends the same session, so the token in memory stays valid. */
export async function unlock(connection: BackendConnection, password: string): Promise<Session> {
  return SessionResponse.parse(
    await apiRequest(connection, '/api/v1/auth/unlock', { method: 'POST', body: { password } }),
  );
}

export async function changePassword(
  connection: BackendConnection,
  currentPassword: string,
  newPassword: string,
): Promise<Session> {
  return SessionResponse.parse(
    await apiRequest(connection, '/api/v1/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  );
}

export async function fetchMe(connection: BackendConnection): Promise<Me> {
  return MeResponse.parse(await apiGet(connection, '/api/v1/me'));
}

export async function fetchPermissions(connection: BackendConnection): Promise<Permissions> {
  return PermissionsResponse.parse(await apiGet(connection, '/api/v1/me/permissions'));
}
