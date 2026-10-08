import {
  CheckResultsResponse,
  Resource,
  ResourceList,
  type BackendConnection,
  type CheckResultsRequest,
  type ResourceCreateRequest,
  type ResourceUpdateRequest,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/** `/api/v1/…/resources` (WP-20b), parsed against the contract. */

export async function listResources(
  connection: BackendConnection,
  competitionId: string,
): Promise<ResourceList> {
  return ResourceList.parse(
    await apiGet(connection, `/api/v1/competitions/${competitionId}/resources`),
  );
}

export async function createResource(
  connection: BackendConnection,
  body: ResourceCreateRequest,
): Promise<Resource> {
  return Resource.parse(
    await apiRequest(connection, '/api/v1/resources', { method: 'POST', body }),
  );
}

export async function updateResource(
  connection: BackendConnection,
  id: string,
  body: ResourceUpdateRequest,
): Promise<Resource> {
  return Resource.parse(
    await apiRequest(connection, `/api/v1/resources/${id}`, { method: 'PATCH', body }),
  );
}

export async function deleteResource(
  connection: BackendConnection,
  id: string,
  version: number,
): Promise<void> {
  await apiRequest(connection, `/api/v1/resources/${id}`, {
    method: 'DELETE',
    body: { version },
  });
}

export async function postCheckResults(
  connection: BackendConnection,
  body: CheckResultsRequest,
): Promise<CheckResultsResponse> {
  return CheckResultsResponse.parse(
    await apiRequest(connection, '/api/v1/resources/check-results', { method: 'POST', body }),
  );
}
