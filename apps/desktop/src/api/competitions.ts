import {
  AssignPreview,
  AssignResult,
  CompetitionDetail,
  CompetitionListResponse,
  type AssignRequestInput,
  type BackendConnection,
  type CompetitionQueryInput,
  type CompetitionTransferRequest,
  type EngagementStatus,
  type WorkflowChoiceInput,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/** `/api/v1/competitions…` (WP-19), parsed against the contract. */

const detail = async (promise: Promise<unknown>): Promise<CompetitionDetail> =>
  CompetitionDetail.parse(await promise);

const post = (
  connection: BackendConnection,
  path: string,
  body: unknown,
): Promise<CompetitionDetail> => detail(apiRequest(connection, path, { method: 'POST', body }));

/** The list query as a query string; arrays become comma lists. */
export function competitionListPath(query: CompetitionQueryInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.map(String).join(','));
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return `/api/v1/competitions${text === '' ? '' : `?${text}`}`;
}

export async function listCompetitions(
  connection: BackendConnection,
  query: CompetitionQueryInput,
): Promise<CompetitionListResponse> {
  return CompetitionListResponse.parse(await apiGet(connection, competitionListPath(query)));
}

export const getCompetition = (
  connection: BackendConnection,
  id: string,
): Promise<CompetitionDetail> => detail(apiGet(connection, `/api/v1/competitions/${id}`));

export async function previewAssign(
  connection: BackendConnection,
  body: AssignRequestInput,
): Promise<AssignPreview> {
  return AssignPreview.parse(
    await apiRequest(connection, '/api/v1/competitions/assign/preview', { method: 'POST', body }),
  );
}

export async function assignCompetition(
  connection: BackendConnection,
  body: AssignRequestInput,
): Promise<AssignResult> {
  return AssignResult.parse(
    await apiRequest(connection, '/api/v1/competitions/assign', { method: 'POST', body }),
  );
}

export const transitionCompetition = (
  connection: BackendConnection,
  id: string,
  to: EngagementStatus,
  version: number,
  options: { readonly note?: string; readonly workflow?: WorkflowChoiceInput } = {},
): Promise<CompetitionDetail> =>
  post(connection, `/api/v1/competitions/${id}/transitions`, {
    to,
    version,
    ...(options.note === undefined ? {} : { note: options.note }),
    // WP-20a: CONSIDERING → ASSIGNED copies this template (absent → the type's default).
    ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
  });

export const updateCompetitionNotes = (
  connection: BackendConnection,
  id: string,
  notes: string | null,
  version: number,
): Promise<CompetitionDetail> =>
  detail(
    apiRequest(connection, `/api/v1/competitions/${id}`, {
      method: 'PATCH',
      body: { notes, version },
    }),
  );

export const addParticipant = (
  connection: BackendConnection,
  id: string,
  body: { studentId: string; roleLabel?: string | null; version: number },
): Promise<CompetitionDetail> => post(connection, `/api/v1/competitions/${id}/participants`, body);

export const removeParticipant = (
  connection: BackendConnection,
  id: string,
  studentId: string,
  version: number,
): Promise<CompetitionDetail> =>
  post(connection, `/api/v1/competitions/${id}/participants/${studentId}/remove`, { version });

export const addCompetitionMentor = (
  connection: BackendConnection,
  id: string,
  userId: string,
  version: number,
): Promise<CompetitionDetail> =>
  post(connection, `/api/v1/competitions/${id}/mentors`, { userId, version });

export const endCompetitionMentor = (
  connection: BackendConnection,
  id: string,
  mentorId: string,
  version: number,
): Promise<CompetitionDetail> =>
  post(connection, `/api/v1/competitions/${id}/mentors/${mentorId}/end`, { version });

export const transferCompetitionPrimary = (
  connection: BackendConnection,
  id: string,
  body: CompetitionTransferRequest,
): Promise<CompetitionDetail> =>
  post(connection, `/api/v1/competitions/${id}/transfer-primary`, body);
