import {
  InterestTagOptions,
  MyInterestsView,
  SavedSearch,
  SavedSearchCreate,
  SavedSearchList,
  SavedSearchPatch,
  type BackendConnection,
  type MyInterestsUpdate,
  type SavedSearchCreateInput,
  type SavedSearchPatchInput,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * `/api/v1/saved-searches` and `/api/v1/me/interests` (WP-24, R112–R113),
 * parsed both ways. Every call is the signed-in person's own.
 */

export const SAVED_SEARCHES_KEY = ['saved-searches'] as const;
export const INTERESTS_KEY = ['me', 'interests'] as const;
export const interestTagOptionsKey = (text: string) =>
  ['me', 'interests', 'tag-options', text] as const;

const searchPath = (id: string): string => `/api/v1/saved-searches/${encodeURIComponent(id)}`;

export async function listSavedSearches(connection: BackendConnection): Promise<SavedSearchList> {
  return SavedSearchList.parse(await apiGet(connection, '/api/v1/saved-searches'));
}

export async function createSavedSearch(
  connection: BackendConnection,
  input: SavedSearchCreateInput,
): Promise<SavedSearch> {
  return SavedSearch.parse(
    await apiRequest(connection, '/api/v1/saved-searches', {
      method: 'POST',
      body: SavedSearchCreate.parse(input),
    }),
  );
}

export async function patchSavedSearch(
  connection: BackendConnection,
  id: string,
  input: SavedSearchPatchInput,
): Promise<SavedSearch> {
  return SavedSearch.parse(
    await apiRequest(connection, searchPath(id), {
      method: 'PATCH',
      body: SavedSearchPatch.parse(input),
    }),
  );
}

export async function deleteSavedSearch(
  connection: BackendConnection,
  id: string,
  version: number,
): Promise<void> {
  await apiRequest(connection, `${searchPath(id)}?version=${String(version)}`, {
    method: 'DELETE',
  });
}

export async function getInterests(connection: BackendConnection): Promise<MyInterestsView> {
  return MyInterestsView.parse(await apiGet(connection, '/api/v1/me/interests'));
}

export async function putInterests(
  connection: BackendConnection,
  update: MyInterestsUpdate,
): Promise<MyInterestsView> {
  return MyInterestsView.parse(
    await apiRequest(connection, '/api/v1/me/interests', { method: 'PUT', body: update }),
  );
}

export async function setCategoryInterest(
  connection: BackendConnection,
  categoryId: string,
  on: boolean,
): Promise<MyInterestsView> {
  return MyInterestsView.parse(
    await apiRequest(
      connection,
      `/api/v1/me/interests/categories/${encodeURIComponent(categoryId)}`,
      { method: on ? 'POST' : 'DELETE' },
    ),
  );
}

export async function interestTagOptions(
  connection: BackendConnection,
  text: string,
): Promise<InterestTagOptions> {
  const params = new URLSearchParams({ text });
  return InterestTagOptions.parse(
    await apiGet(connection, `/api/v1/me/interests/tag-options?${params.toString()}`),
  );
}
