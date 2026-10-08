import {
  OutcomeView,
  StudentHistory,
  type BackendConnection,
  type OutcomeInput,
} from '@compintel/contracts';

import { apiGet, apiRequest } from './client.js';

/** `/api/v1/competitions/:id/outcome` and `/students/:id/history` (WP-21). */

export async function saveOutcome(
  connection: BackendConnection,
  competitionId: string,
  body: OutcomeInput,
): Promise<OutcomeView> {
  return OutcomeView.parse(
    await apiRequest(connection, `/api/v1/competitions/${competitionId}/outcome`, {
      method: 'PUT',
      body,
    }),
  );
}

export async function removeOutcome(
  connection: BackendConnection,
  competitionId: string,
  version: number,
): Promise<void> {
  await apiRequest(connection, `/api/v1/competitions/${competitionId}/outcome`, {
    method: 'DELETE',
    body: { version },
  });
}

export async function studentHistory(
  connection: BackendConnection,
  studentId: string,
): Promise<StudentHistory> {
  return StudentHistory.parse(await apiGet(connection, `/api/v1/students/${studentId}/history`));
}
