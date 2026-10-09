import {
  DeadlineListResponse,
  KpiResponse,
  type BackendConnection,
  type DeadlineQueryInput,
  type KpiScope,
} from '@compintel/contracts';

import { apiGet } from './client.js';

/** `/api/v1/deadlines` and `/api/v1/dashboard/kpis` (WP-22), parsed against the contract. */

export function deadlinesPath(query: DeadlineQueryInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as [string, string | number | undefined][]) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return `/api/v1/deadlines?${params.toString()}`;
}

export async function listDeadlines(
  connection: BackendConnection,
  query: DeadlineQueryInput,
): Promise<DeadlineListResponse> {
  return DeadlineListResponse.parse(await apiGet(connection, deadlinesPath(query)));
}

export async function getKpis(
  connection: BackendConnection,
  scope: KpiScope,
): Promise<KpiResponse> {
  return KpiResponse.parse(await apiGet(connection, `/api/v1/dashboard/kpis?scope=${scope}`));
}
