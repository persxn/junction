import type { KpiResponse, KpiTile } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeEvent } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { ok, withWorkflow, write } from '../../testing/workflows.js';

/**
 * The §19 AC "every KPI equals its list's total" (WP-22, R107): each tile's
 * value is compared with the total that its `link` returns from the real list
 * endpoint, sent the way the list screen sends it — not with the tile's code.
 */

let h: StudentsHarness;
let server: TestServer;
const DAY = 86_400_000;
beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
  const now = h.clock.now().getTime();
  // Events starting soon, one closing in two days, one long past.
  for (const days of [3, 10, 40]) {
    const id = makeEvent(h, { title: `Upcoming ${String(days)}` });
    h.database.db.raw
      .prepare("UPDATE events SET starts_at = ?, date_precision = 'DATE' WHERE id = ?")
      .run(now + days * DAY, id);
  }
  makeEvent(h, { title: 'Closing fast', registrationDeadlineAt: now + 2 * DAY });
  const past = makeEvent(h, { title: 'Long gone' });
  h.database.db.raw
    .prepare('UPDATE events SET starts_at = ? WHERE id = ?')
    .run(now - 30 * DAY, past);
  // Competitions: one of Alice's with an overdue task, one of Bob's.
  const { view, competitionId } = await withWorkflow(server, h, h.alice);
  const stage = view.stages[0]!;
  await ok(
    write(server, h.alice, competitionId, 'PATCH', `tasks/${stage.tasks[0]!.id}`, {
      dueAt: new Date(now - 2 * DAY).toISOString(),
      version: stage.version,
    }),
  );
  await withWorkflow(server, h, h.bob);
});
afterAll(async () => {
  await server.close();
  h.close();
});

/** The list endpoint behind a tile, called as its screen calls it. */
async function listTotal(tile: KpiTile): Promise<number> {
  const search = tile.link.search;
  if (tile.link.to === '/discover') {
    // Discover's "All events" tab: the chips, excludeHidden, sort by deadline.
    const response = await call(server, 'POST', '/api/v1/search/events', {
      as: h.alice,
      body: {
        ...(search.filters as object),
        includeUnknown: {},
        excludeHidden: true,
        sort: 'DEADLINE',
        limit: 50,
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.total as number;
  }
  if (tile.link.to === '/competitions') {
    const status = (search.status as string[]).join(',');
    const mine = search.mine === true ? '&mentorId=me' : '';
    const response = await call(server, 'GET', `/api/v1/competitions?status=${status}${mine}`, {
      as: h.alice,
    });
    return response.body.total as number;
  }
  const query = new URLSearchParams(search as Record<string, string>).toString();
  const response = await call(server, 'GET', `/api/v1/deadlines?${query}`, { as: h.alice });
  return response.body.total as number;
}

describe('§19: every KPI equals its list’s total', () => {
  it.each(['MINE', 'ALL'] as const)('scope %s', async (scope) => {
    const response = await call(server, 'GET', `/api/v1/dashboard/kpis?scope=${scope}`, {
      as: h.alice,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const { tiles } = response.body as unknown as KpiResponse;
    expect(tiles.map((tile) => tile.key)).toEqual([
      'UPCOMING_EVENTS',
      'CLOSING_SOON',
      'ACTIVE_COMPETITIONS',
      'OVERDUE_TASKS',
    ]);
    for (const tile of tiles) expect(tile.value, tile.key).toBe(await listTotal(tile));
    const value = (key: string) => tiles.find((tile) => tile.key === key)!.value;
    expect(value('UPCOMING_EVENTS')).toBeGreaterThanOrEqual(3);
    expect(value('CLOSING_SOON')).toBeGreaterThanOrEqual(1);
    expect(value('ACTIVE_COMPETITIONS')).toBe(scope === 'MINE' ? 1 : 2);
    expect(value('OVERDUE_TASKS')).toBe(1);
  });
});
