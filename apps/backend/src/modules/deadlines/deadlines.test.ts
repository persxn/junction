import {
  DEADLINE_GROUPS,
  URGENCY_BUCKETS,
  type CompetitionDetail,
  type DeadlineListResponse,
  type DueItem,
} from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeEvent, teamWith } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { ok, withWorkflow, write } from '../../testing/workflows.js';

/**
 * `GET /deadlines` (WP-22, R106–R107, D-03): scopes, a hidden event, and the
 * §19 AC "counts match list views" literally — for every scope × group ×
 * bucket, the count is the length of the fully paged list.
 */

let h: StudentsHarness;
let server: TestServer;
let teamId: string;
beforeAll(async () => {
  // 1 Oct 2026, 10:00 IST.
  h = openStudentsHarness();
  server = await startStudentsServer(h);
  // A competition with work in every bucket: overdue, today, ≤ 3, ≤ 7, later.
  const team = await teamWith(server, h, h.alice, 'Radar Team');
  teamId = team.id;
  const { view, competitionId } = await withWorkflow(server, h, h.alice, { teamId: team.id });
  const dates = [
    '2026-09-29T06:00:00.000Z',
    '2026-10-01T12:00:00.000Z',
    '2026-10-03T06:00:00.000Z',
    '2026-10-06T06:00:00.000Z',
    '2026-10-25T06:00:00.000Z',
  ];
  let current = view;
  for (const [index, stage] of view.stages.entries()) {
    current = await ok(
      write(server, h.alice, competitionId, 'PATCH', `stages/${stage.id}`, {
        dueAt: dates[index],
        version: current.stages.find((s) => s.id === stage.id)!.version,
      }),
    );
  }
  const first = current.stages[0]!;
  await ok(
    write(server, h.alice, competitionId, 'PATCH', `tasks/${first.tasks[0]!.id}`, {
      dueAt: '2026-09-30T06:00:00.000Z',
      version: first.version,
    }),
  );
});
afterAll(async () => {
  await server.close();
  h.close();
});

const get = async (query: string, as = h.alice): Promise<DeadlineListResponse> => {
  const response = await call(server, 'GET', `/api/v1/deadlines?${query}`, { as });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as unknown as DeadlineListResponse;
};

async function fullyPaged(query: string): Promise<DueItem[]> {
  const items: DueItem[] = [];
  let cursor: string | null = null;
  do {
    const page: DeadlineListResponse = await get(
      `${query}&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

describe('§19: counts match list views', () => {
  it('for every scope × group × bucket, the count is the fully paged list’s length', async () => {
    const scopes = ['scope=MINE', 'scope=ALL', `scope=TEAM&teamId=${teamId}`];
    for (const scope of scopes) {
      for (const group of [undefined, ...DEADLINE_GROUPS]) {
        const base = group === undefined ? scope : `${scope}&group=${group}`;
        const { counts } = await get(base);
        for (const bucket of URGENCY_BUCKETS) {
          const listed = await fullyPaged(`${base}&bucket=${bucket}`);
          expect(listed.length, `${base} ${bucket}`).toBe(counts[bucket]);
          expect(new Set(listed.map((item) => item.id)).size).toBe(listed.length);
          expect(listed.every((item) => item.bucket === bucket)).toBe(true);
        }
      }
    }
    const { counts } = await get('scope=MINE&group=WORK');
    expect(counts).toMatchObject({ OVERDUE: 2, TODAY: 1, DAYS_3: 1, DAYS_7: 1, LATER: 1 });
  });
});

describe('scopes (D-03)', () => {
  it('a saved event with no competition is in my Mine and All, and nobody else’s', async () => {
    const eventId = makeEvent(h, { title: 'Saved Alone' });
    h.database.db.raw
      .prepare('INSERT INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, 0)')
      .run(h.alice.id, eventId);
    const has = (list: DeadlineListResponse) => list.items.some((item) => item.eventId === eventId);
    expect(has(await get('scope=MINE&limit=200'))).toBe(true);
    expect(has(await get('scope=ALL&limit=200'))).toBe(true);
    expect(has(await get('scope=MINE&limit=200', h.bob))).toBe(false);
    expect(has(await get('scope=ALL&limit=200', h.bob))).toBe(false);
  });

  it('a co-mentor sees the work in Mine until their period ends', async () => {
    const { competitionId } = await withWorkflow(server, h, h.alice);
    const page = (
      await call(server, 'GET', `/api/v1/competitions/${competitionId}`, { as: h.alice })
    ).body as unknown as CompetitionDetail;
    const added = (
      await call(server, 'POST', `/api/v1/competitions/${competitionId}/mentors`, {
        as: h.alice,
        body: { userId: h.bob.id, version: page.version },
      })
    ).body as unknown as CompetitionDetail;
    const mine = async () =>
      (await get('scope=MINE&limit=200', h.bob)).items.some(
        (item) => item.engagementId === competitionId,
      );
    expect(await mine()).toBe(true);
    const bob = added.mentors.find((mentor) => mentor.userId === h.bob.id)!;
    const ended = await call(
      server,
      'POST',
      `/api/v1/competitions/${competitionId}/mentors/${bob.id}/end`,
      {
        as: h.alice,
        body: { version: added.version },
      },
    );
    expect(ended.status).toBe(200);
    expect(await mine()).toBe(false);
  });

  it('an event I hid leaves my event deadlines; the team scope needs a team', async () => {
    const eventId = makeEvent(h, { title: 'Hidden Away' });
    h.database.db.raw
      .prepare('INSERT INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, 0)')
      .run(h.alice.id, eventId);
    h.database.db.raw
      .prepare('INSERT INTO event_user_state (user_id, event_id, is_hidden) VALUES (?, ?, 1)')
      .run(h.alice.id, eventId);
    expect((await get('scope=MINE&limit=200')).items.some((item) => item.eventId === eventId)).toBe(
      false,
    );
    expect(
      (await call(server, 'GET', '/api/v1/deadlines?scope=TEAM', { as: h.alice })).status,
    ).toBe(400);
  });
});
