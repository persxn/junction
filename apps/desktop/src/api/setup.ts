import {
  PathCheckResult,
  PlaceSuggestionsResponse,
  SetupResult,
  SetupStatus,
  type BackendConnection,
  type PathCheckResult as PathCheck,
  type PlaceSuggestion as PlaceSuggestionType,
  type SetupRequest,
  type SetupResult as Result,
  type SetupStatus as Status,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/**
 * The three routes a fresh installation answers (rulings R39–R44).
 *
 * `status` is the first call the app ever makes after `/health`: until it comes
 * back saying `required: false` there is no point offering a login screen,
 * because the server would answer every other route with `SETUP_REQUIRED`.
 */

export async function fetchSetupStatus(connection: BackendConnection): Promise<Status> {
  return SetupStatus.parse(await apiGet(connection, '/api/v1/setup/status'));
}

/** Ruling R43: the backend write-probes the folder; the UI never guesses. */
export async function checkBackupPath(
  connection: BackendConnection,
  path: string,
): Promise<PathCheck> {
  return PathCheckResult.parse(
    await apiRequest(connection, '/api/v1/setup/check-path', {
      method: 'POST',
      body: { path },
    }),
  );
}

/**
 * The whole wizard in one call (R40). The response is the only time the recovery
 * code and the recovery file exist anywhere; nothing can fetch them again.
 */
export async function completeSetup(
  connection: BackendConnection,
  request: SetupRequest,
): Promise<Result> {
  return SetupResult.parse(
    await apiRequest(connection, '/api/v1/setup/complete', { method: 'POST', body: request }),
  );
}

/** WP-34: the location picker — institutions and cities from the offline gazetteer. */
export async function suggestPlaces(
  connection: BackendConnection,
  query: string,
): Promise<readonly PlaceSuggestionType[]> {
  const answer = PlaceSuggestionsResponse.parse(
    await apiGet(connection, `/api/v1/setup/places?q=${encodeURIComponent(query)}`),
  );
  return answer.places;
}
