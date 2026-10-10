import {
  Appearance,
  InsightsResponse,
  type AppearanceInput,
  type BackendConnection,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/** WP-33: the caller's own appearance (R67–R68) and the Insights read model (R69). */

export async function getAppearance(connection: BackendConnection): Promise<Appearance> {
  return Appearance.parse(await apiGet(connection, '/api/v1/me/appearance'));
}

export async function saveAppearance(
  connection: BackendConnection,
  input: AppearanceInput,
): Promise<Appearance> {
  return Appearance.parse(
    await apiRequest(connection, '/api/v1/me/appearance', { method: 'PUT', body: input }),
  );
}

export function insightsPath(range: { from?: string; to?: string }): string {
  const params = new URLSearchParams();
  if (range.from !== undefined) params.set('from', range.from);
  if (range.to !== undefined) params.set('to', range.to);
  const query = params.toString();
  return `/api/v1/insights${query === '' ? '' : `?${query}`}`;
}

export async function getInsights(
  connection: BackendConnection,
  range: { from?: string; to?: string },
): Promise<InsightsResponse> {
  return InsightsResponse.parse(await apiGet(connection, insightsPath(range)));
}
