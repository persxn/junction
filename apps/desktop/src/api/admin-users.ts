import {
  TemporaryPasswordResult,
  UserListResponse,
  UserResponse,
  type BackendConnection,
  type CreateUserRequest,
  type TemporaryPasswordResult as TemporaryPassword,
  type UpdateUserRequest,
  type UserSummary,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * `/admin/users` (§10.2 `user.manage`).
 *
 * The one-time passwords these calls return are shown once and never stored;
 * they exist in the response and in the component's state, and nowhere else.
 */

export async function listUsers(connection: BackendConnection): Promise<readonly UserSummary[]> {
  return UserListResponse.parse(await apiGet(connection, '/api/v1/admin/users')).users;
}

export async function createUser(
  connection: BackendConnection,
  request: CreateUserRequest,
): Promise<TemporaryPassword> {
  return TemporaryPasswordResult.parse(
    await apiRequest(connection, '/api/v1/admin/users', { method: 'POST', body: request }),
  );
}

export async function updateUser(
  connection: BackendConnection,
  id: string,
  request: UpdateUserRequest,
): Promise<UserSummary> {
  return UserResponse.parse(
    await apiRequest(connection, `/api/v1/admin/users/${id}`, { method: 'PATCH', body: request }),
  ).user;
}

export async function setUserEnabled(
  connection: BackendConnection,
  id: string,
  enabled: boolean,
): Promise<UserSummary> {
  return UserResponse.parse(
    await apiRequest(connection, `/api/v1/admin/users/${id}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
    }),
  ).user;
}

export async function resetUserPassword(
  connection: BackendConnection,
  id: string,
): Promise<TemporaryPassword> {
  return TemporaryPasswordResult.parse(
    await apiRequest(connection, `/api/v1/admin/users/${id}/reset-password`, { method: 'POST' }),
  );
}
