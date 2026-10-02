import {
  StudentDetail,
  StudentFormOptions,
  StudentImportCommitResult,
  StudentImportPreview,
  StudentListResponse,
  StudentSettings,
  TagSuggestions,
  type BackendConnection,
  type StartMentorshipRequest,
  type StudentAchievementInput,
  type StudentCreateInput,
  type StudentImportCommitRequest,
  type StudentImportPreviewRequest,
  type StudentListQueryInput,
  type StudentTagsRequest,
  type StudentUpdateRequest,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * `/api/v1/students…` (WP-17). Every answer is parsed against the contract, so
 * a shape change between the halves of the app fails here, loudly.
 */

/**
 * A 5 000-row file takes seconds to validate, not the 2 s the client allows a
 * request. A timeout here would also be read as "loopback is blocked" and move
 * the window onto the shell proxy for good, so the two import calls get the
 * proxy's own 15 s.
 */
export const IMPORT_TIMEOUT_MS = 15_000;

const detail = async (promise: Promise<unknown>): Promise<StudentDetail> =>
  StudentDetail.parse(await promise);

/** The list query as a query string; arrays become comma lists. */
export function studentListPath(query: StudentListQueryInput): string {
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
  return `/api/v1/students${text === '' ? '' : `?${text}`}`;
}

export async function listStudents(
  connection: BackendConnection,
  query: StudentListQueryInput,
): Promise<StudentListResponse> {
  return StudentListResponse.parse(await apiGet(connection, studentListPath(query)));
}

export async function studentFormOptions(
  connection: BackendConnection,
): Promise<StudentFormOptions> {
  return StudentFormOptions.parse(await apiGet(connection, '/api/v1/students/options'));
}

export const getStudent = (connection: BackendConnection, id: string): Promise<StudentDetail> =>
  detail(apiGet(connection, `/api/v1/students/${id}`));

export const createStudent = (
  connection: BackendConnection,
  body: StudentCreateInput,
): Promise<StudentDetail> =>
  detail(apiRequest(connection, '/api/v1/students', { method: 'POST', body }));

export const updateStudent = (
  connection: BackendConnection,
  id: string,
  body: StudentUpdateRequest,
): Promise<StudentDetail> =>
  detail(apiRequest(connection, `/api/v1/students/${id}`, { method: 'PATCH', body }));

export const setStudentTags = (
  connection: BackendConnection,
  id: string,
  body: StudentTagsRequest,
): Promise<StudentDetail> =>
  detail(apiRequest(connection, `/api/v1/students/${id}/tags`, { method: 'PUT', body }));

export const setStudentActive = (
  connection: BackendConnection,
  id: string,
  active: boolean,
  version: number,
): Promise<StudentDetail> =>
  detail(
    apiRequest(connection, `/api/v1/students/${id}/${active ? 'reactivate' : 'deactivate'}`, {
      method: 'POST',
      body: { version },
    }),
  );

export const eraseStudent = (
  connection: BackendConnection,
  id: string,
  universityId: string,
): Promise<StudentDetail> =>
  detail(
    apiRequest(connection, `/api/v1/admin/students/${id}/erase`, {
      method: 'POST',
      body: { universityId },
    }),
  );

export const startMentorship = (
  connection: BackendConnection,
  studentId: string,
  body: StartMentorshipRequest,
): Promise<StudentDetail> =>
  detail(
    apiRequest(connection, `/api/v1/students/${studentId}/mentorships`, { method: 'POST', body }),
  );

export const endMentorship = (
  connection: BackendConnection,
  mentorshipId: string,
): Promise<StudentDetail> =>
  detail(apiRequest(connection, `/api/v1/mentorships/${mentorshipId}/end`, { method: 'POST' }));

export const addAchievement = (
  connection: BackendConnection,
  studentId: string,
  body: StudentAchievementInput,
): Promise<StudentDetail> =>
  detail(
    apiRequest(connection, `/api/v1/students/${studentId}/achievements`, { method: 'POST', body }),
  );

export const deleteAchievement = (
  connection: BackendConnection,
  studentId: string,
  achievementId: string,
): Promise<StudentDetail> =>
  detail(
    apiRequest(connection, `/api/v1/students/${studentId}/achievements/${achievementId}`, {
      method: 'DELETE',
    }),
  );

export async function suggestTags(
  connection: BackendConnection,
  kind: 'SKILL' | 'INTEREST',
  text: string,
): Promise<TagSuggestions['tags']> {
  const path = `/api/v1/tags?kind=${kind}&text=${encodeURIComponent(text)}`;
  return TagSuggestions.parse(await apiGet(connection, path)).tags;
}

export async function previewImport(
  connection: BackendConnection,
  body: StudentImportPreviewRequest,
): Promise<StudentImportPreview> {
  return StudentImportPreview.parse(
    await apiRequest(connection, '/api/v1/students/import/preview', {
      method: 'POST',
      body,
      timeoutMs: IMPORT_TIMEOUT_MS,
    }),
  );
}

export async function commitImport(
  connection: BackendConnection,
  body: StudentImportCommitRequest,
): Promise<StudentImportCommitResult> {
  return StudentImportCommitResult.parse(
    await apiRequest(connection, '/api/v1/students/import/commit', {
      method: 'POST',
      body,
      timeoutMs: IMPORT_TIMEOUT_MS,
    }),
  );
}

export async function studentSettings(connection: BackendConnection): Promise<StudentSettings> {
  return StudentSettings.parse(await apiGet(connection, '/api/v1/admin/settings/students'));
}

export async function saveStudentSettings(
  connection: BackendConnection,
  body: StudentSettings,
): Promise<StudentSettings> {
  return StudentSettings.parse(
    await apiRequest(connection, '/api/v1/admin/settings/students', { method: 'PUT', body }),
  );
}
