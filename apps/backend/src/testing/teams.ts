import type { TeamDetail } from '@compintel/contracts';
import { expect } from 'vitest';

import type { Principal } from '../modules/auth/types.js';
import type { TestServer } from './harness.js';
import { call, type StudentsHarness } from './students.js';

/**
 * WP-18's test helpers over the students harness: a synthetic student with
 * skills, and a team created over HTTP. Synthetic data only (D-33).
 */

export function makeTeamStudent(
  h: StudentsHarness,
  n: number,
  skills: [string, 1 | 2 | 3 | null][] = [],
): string {
  const created = h.module.records.create(h.context(h.alice), {
    universityId: `TEAM${String(n).padStart(4, '0')}`,
    fullName: `Team Student ${String(n)}`,
    program: 'BTECH',
    mentorMe: false,
  });
  if (skills.length > 0) {
    h.module.relations.setTags(h.context(h.alice), created.id, {
      version: created.version,
      tags: skills.map(([name, proficiency]) => ({
        name,
        relation: 'SKILL' as const,
        proficiency,
      })),
    });
  }
  return created.id;
}

export async function createTeam(
  server: TestServer,
  as: Principal,
  body: Record<string, unknown>,
): Promise<TeamDetail> {
  const response = await call(server, 'POST', '/api/v1/teams', { as, body });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown as TeamDetail;
}

export async function getTeam(server: TestServer, id: string, as: Principal): Promise<TeamDetail> {
  return (await call(server, 'GET', `/api/v1/teams/${id}`, { as })).body as unknown as TeamDetail;
}
