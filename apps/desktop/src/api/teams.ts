import {
  ProfessorList,
  TeamDetail,
  TeamListResponse,
  type BackendConnection,
  type TeamAddMemberRequest,
  type TeamCreateInput,
  type TeamListQuery,
  type TeamTransferPrimaryRequest,
  type TeamUpdateMemberRequest,
  type TeamUpdateRequest,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/** `/api/v1/teams…` and `/professors` (WP-18), parsed against the contract. */

const detail = async (promise: Promise<unknown>): Promise<TeamDetail> =>
  TeamDetail.parse(await promise);

const post = (connection: BackendConnection, path: string, body: unknown): Promise<TeamDetail> =>
  detail(apiRequest(connection, path, { method: 'POST', body }));

export function teamListPath(query: TeamListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return `/api/v1/teams${text === '' ? '' : `?${text}`}`;
}

export async function listTeams(
  connection: BackendConnection,
  query: TeamListQuery,
): Promise<TeamListResponse> {
  return TeamListResponse.parse(await apiGet(connection, teamListPath(query)));
}

export const getTeam = (connection: BackendConnection, id: string): Promise<TeamDetail> =>
  detail(apiGet(connection, `/api/v1/teams/${id}`));

export const createTeam = (
  connection: BackendConnection,
  body: TeamCreateInput,
): Promise<TeamDetail> => post(connection, '/api/v1/teams', body);

export const updateTeam = (
  connection: BackendConnection,
  id: string,
  body: TeamUpdateRequest,
): Promise<TeamDetail> =>
  detail(apiRequest(connection, `/api/v1/teams/${id}`, { method: 'PATCH', body }));

export const setTeamArchived = (
  connection: BackendConnection,
  id: string,
  archived: boolean,
  version: number,
): Promise<TeamDetail> =>
  post(connection, `/api/v1/teams/${id}/${archived ? 'archive' : 'unarchive'}`, { version });

export const addMember = (
  connection: BackendConnection,
  teamId: string,
  body: TeamAddMemberRequest,
): Promise<TeamDetail> => post(connection, `/api/v1/teams/${teamId}/members`, body);

export const updateMember = (
  connection: BackendConnection,
  teamId: string,
  memberId: string,
  body: TeamUpdateMemberRequest,
): Promise<TeamDetail> =>
  detail(
    apiRequest(connection, `/api/v1/teams/${teamId}/members/${memberId}`, {
      method: 'PATCH',
      body,
    }),
  );

export const removeMember = (
  connection: BackendConnection,
  teamId: string,
  memberId: string,
  version: number,
): Promise<TeamDetail> =>
  post(connection, `/api/v1/teams/${teamId}/members/${memberId}/leave`, { version });

export const addMentor = (
  connection: BackendConnection,
  teamId: string,
  userId: string,
  version: number,
): Promise<TeamDetail> => post(connection, `/api/v1/teams/${teamId}/mentors`, { userId, version });

export const endMentor = (
  connection: BackendConnection,
  teamId: string,
  mentorId: string,
  version: number,
): Promise<TeamDetail> =>
  post(connection, `/api/v1/teams/${teamId}/mentors/${mentorId}/end`, { version });

export const transferPrimary = (
  connection: BackendConnection,
  teamId: string,
  body: TeamTransferPrimaryRequest,
): Promise<TeamDetail> => post(connection, `/api/v1/teams/${teamId}/transfer-primary`, body);

export async function listProfessors(
  connection: BackendConnection,
): Promise<ProfessorList['professors']> {
  return ProfessorList.parse(await apiGet(connection, '/api/v1/professors')).professors;
}
