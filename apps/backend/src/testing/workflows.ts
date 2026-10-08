import type { WorkflowView } from '@compintel/contracts';
import { expect } from 'vitest';

import { SEED_TEMPLATES } from '../domain/workflows/seed-templates.js';
import type { Principal } from '../modules/auth/types.js';
import { assigned, freshStudent, makeEvent, teamWith } from './competitions.js';
import type { TestServer } from './harness.js';
import { call, type StudentsHarness } from './students.js';

/**
 * WP-20a's test helpers: a competition assigned with a workflow, its view,
 * and one workflow write over HTTP. Synthetic data only (D-33).
 */

export const HACKATHON_TEMPLATE = SEED_TEMPLATES[0]?.id ?? '';

export interface Assigned {
  readonly competitionId: string;
  readonly eventId: string;
  readonly studentIds: readonly string[];
  readonly view: WorkflowView;
}

let teams = 0;

/** A team competition at ASSIGNED for `as`: two fresh students, the type's default workflow. */
export async function withWorkflow(
  server: TestServer,
  h: StudentsHarness,
  as: Principal,
  extra: Record<string, unknown> = {},
): Promise<Assigned> {
  const eventId = makeEvent(h);
  const studentIds = [freshStudent(h), freshStudent(h)];
  teams += 1;
  const team = await teamWith(server, h, as, `Workflow team ${String(teams)}`, studentIds);
  const competition = await assigned(server, as, { eventId, teamId: team.id, ...extra });
  const view = await workflowOf(server, competition.id, as);
  return { competitionId: competition.id, eventId, studentIds, view };
}

export async function workflowOf(
  server: TestServer,
  competitionId: string,
  as: Principal,
): Promise<WorkflowView> {
  const response = await call(server, 'GET', `/api/v1/competitions/${competitionId}/workflow`, {
    as,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown as WorkflowView;
}

/** One write under `/competitions/:id/workflow/<path>`. */
export async function write(
  server: TestServer,
  as: Principal,
  competitionId: string,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(server, method, `/api/v1/competitions/${competitionId}/workflow/${path}`, {
    as,
    body,
  });
}

/** A write that must succeed; returns the new view. */
export async function ok(
  response: Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<WorkflowView> {
  const result = await response;
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body as unknown as WorkflowView;
}

export function auditActions(h: StudentsHarness, competitionId: string): string[] {
  return (
    h.database.db.raw
      .prepare(
        `SELECT action FROM audit_log WHERE entity_kind = 'competition' AND entity_id = ?
         ORDER BY rowid`,
      )
      .all(competitionId) as { action: string }[]
  ).map((row) => row.action);
}
