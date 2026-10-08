import type { CompetitionDetail, TeamDetail } from '@compintel/contracts';
import { expect } from 'vitest';

import type { Principal } from '../modules/auth/types.js';
import { uuid7 } from '../platform/ids.js';
import type { TestServer } from './harness.js';
import { call, type StudentsHarness } from './students.js';
import { createTeam, makeTeamStudent } from './teams.js';

/**
 * WP-19's test helpers over the students harness: a synthetic event, a team
 * with members, and an assignment over HTTP. Synthetic data only (D-33).
 */

const DAY = 86_400_000;

export interface EventPatch {
  readonly title?: string;
  readonly registrationDeadlineAt?: number | null;
  readonly teamMin?: number | null;
  readonly teamMax?: number | null;
  readonly cancellation?: 'NONE' | 'CANCELLED' | 'POSTPONED';
  readonly mergedInto?: string;
}

export function makeEvent(h: StudentsHarness, patch: EventPatch = {}): string {
  const id = uuid7();
  const at = h.clock.now().getTime();
  const title = patch.title ?? `Synthetic Hackathon ${id.slice(-4)}`;
  h.database.db.raw
    .prepare(
      `INSERT INTO events (id, title, normalized_title, event_type, registration_deadline_at,
         registration_deadline_precision, team_min, team_max, cancellation, visibility,
         merged_into_event_id, last_changed_at, first_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'HACKATHON', ?, 'DATE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      title.toLowerCase(),
      patch.registrationDeadlineAt === undefined ? at + 30 * DAY : patch.registrationDeadlineAt,
      patch.teamMin ?? null,
      patch.teamMax ?? null,
      patch.cancellation ?? 'NONE',
      patch.mergedInto === undefined ? 'VISIBLE' : 'MERGED',
      patch.mergedInto ?? null,
      at,
      at,
      at,
      at,
    );
  return id;
}

let serial = 100;

/** A team led by `as`, with `size` fresh active students. */
export async function teamWith(
  server: TestServer,
  h: StudentsHarness,
  as: Principal,
  name: string,
  students: readonly string[] = [],
): Promise<TeamDetail> {
  const members =
    students.length > 0
      ? students
      : [0, 1].map(() => {
          serial += 1;
          return makeTeamStudent(h, serial);
        });
  return createTeam(server, as, { name, members: members.map((studentId) => ({ studentId })) });
}

export function freshStudent(h: StudentsHarness): string {
  serial += 1;
  return makeTeamStudent(h, serial);
}

export async function assign(
  server: TestServer,
  as: Principal,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(server, 'POST', '/api/v1/competitions/assign', { as, body });
}

/** Assigns and expects success; returns the first competition's page. */
export async function assigned(
  server: TestServer,
  as: Principal,
  body: Record<string, unknown>,
): Promise<CompetitionDetail> {
  const response = await assign(server, as, body);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const first = (response.body.competitions as { id: string }[])[0];
  return getCompetition(server, first?.id ?? '', as);
}

export async function getCompetition(
  server: TestServer,
  id: string,
  as: Principal,
): Promise<CompetitionDetail> {
  return (await call(server, 'GET', `/api/v1/competitions/${id}`, { as }))
    .body as unknown as CompetitionDetail;
}

export async function move(
  server: TestServer,
  as: Principal,
  competition: { id: string; version: number },
  to: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(server, 'POST', `/api/v1/competitions/${competition.id}/transitions`, {
    as,
    body: { to, version: competition.version },
  });
}
