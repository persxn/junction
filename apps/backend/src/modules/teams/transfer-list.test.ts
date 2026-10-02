import type { TeamDetail } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Principal } from '../auth/types.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { createTeam, getTeam, makeTeamStudent } from '../../testing/teams.js';

/**
 * WP-18 over HTTP, continued: transferring the primary role, and the list.
 */

let h: StudentsHarness;
let server: TestServer;
beforeEach(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});
afterEach(async () => {
  await server.close();
  h.close();
});

const student = (n: number, skills: [string, 1 | 2 | 3 | null][] = []): string =>
  makeTeamStudent(h, n, skills);
const team = (as: Principal, body: Record<string, unknown>): Promise<TeamDetail> =>
  createTeam(server, as, body);
const get = (id: string, as: Principal = h.alice): Promise<TeamDetail> => getTeam(server, id, as);

describe('transfer primary', () => {
  const primaries = (t: TeamDetail) =>
    t.mentors.filter((m) => m.role === 'PRIMARY').map((m) => m.userId);

  it('leaves exactly one primary; the old one stays as co-mentor or steps away', async () => {
    let t = await team(h.alice, { name: 'Handover' });
    t = (
      await call(server, 'POST', `/api/v1/teams/${t.id}/transfer-primary`, {
        as: h.alice,
        body: { toUserId: h.bob.id, stepAway: false, version: t.version },
      })
    ).body as unknown as TeamDetail;
    expect(primaries(t)).toEqual([h.bob.id]);
    expect(t.mentors.find((m) => m.userId === h.alice.id)?.role).toBe('CO_MENTOR');

    t = (
      await call(server, 'POST', `/api/v1/teams/${t.id}/transfer-primary`, {
        as: h.bob,
        body: { toUserId: h.alice.id, stepAway: true, version: t.version },
      })
    ).body as unknown as TeamDetail;
    expect(primaries(t)).toEqual([h.alice.id]);
    expect(t.mentors.map((m) => m.userId)).toEqual([h.alice.id]);
    expect(t.pastMentors.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a non-professor with 422 and a stale version with 409, writing nothing', async () => {
    const t = await team(h.alice, { name: 'Refusals' });
    const toAdmin = await call(server, 'POST', `/api/v1/teams/${t.id}/transfer-primary`, {
      as: h.alice,
      body: { toUserId: h.admin.id, stepAway: false, version: t.version },
    });
    expect(toAdmin.status).toBe(422);
    const stale = await call(server, 'POST', `/api/v1/teams/${t.id}/transfer-primary`, {
      as: h.alice,
      body: { toUserId: h.bob.id, stepAway: false, version: t.version + 5 },
    });
    expect(stale.status).toBe(409);
    expect(primaries(await get(t.id))).toEqual([h.alice.id]);
  });

  it('the primary cannot be ended as if a co-mentor', async () => {
    const t = await team(h.alice, { name: 'Keep' });
    const response = await call(
      server,
      'POST',
      `/api/v1/teams/${t.id}/mentors/${t.mentors[0]!.id}/end`,
      {
        as: h.alice,
        body: { version: t.version },
      },
    );
    expect(response.body.code).toBe('TEAM_MENTOR_NOT_FOUND');
  });
});

describe('the list', () => {
  it('filters by text, my teams and student, with coverage counts', async () => {
    const s = student(10, [['Python', 1]]);
    await team(h.alice, {
      name: 'Robotics Club',
      members: [{ studentId: s }],
      targets: ['Python', 'C'],
    });
    await team(h.bob, { name: 'Quiz Team' });
    const list = async (query: string, as: Principal = h.alice) =>
      (await call(server, 'GET', `/api/v1/teams${query}`, { as })).body as unknown as {
        items: { name: string; coverage: unknown; isMine: boolean; memberCount: number }[];
      };
    expect((await list('?text=robot')).items.map((t) => t.name)).toEqual(['Robotics Club']);
    expect((await list('?mentor=me')).items.map((t) => t.name)).toEqual(['Robotics Club']);
    expect((await list(`?studentId=${s}`)).items).toHaveLength(1);
    const robotics = (await list('')).items.find((t) => t.name === 'Robotics Club')!;
    expect(robotics).toMatchObject({
      memberCount: 1,
      isMine: true,
      coverage: { covered: 0, thin: 1, missing: 1 },
    });
    expect((await call(server, 'GET', '/api/v1/professors', { as: h.alice })).body).toMatchObject({
      professors: expect.arrayContaining([
        expect.objectContaining({ userId: h.bob.id }),
      ]) as unknown,
    });
  });
});
