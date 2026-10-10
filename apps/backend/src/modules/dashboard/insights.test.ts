import type { InsightsResponse } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assigned, freshStudent, makeEvent, move, teamWith } from '../../testing/competitions.js';
import type { TestServer } from '../../testing/harness.js';
import { uuid7 } from '../../platform/ids.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';

/**
 * `GET /insights` end to end (WP-33, R69): seeded through the real assign and
 * transition routes, so every number is checked against rows the product
 * itself wrote, and the active count against the Competitions list.
 */

let h: StudentsHarness;
let server: TestServer;
let shared: string;
beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
  const now = h.clock.now().getTime();

  // A source that reported event A (R69's source contribution).
  const eventA = makeEvent(h, { title: 'Synthetic Hack A' });
  const sourceId = uuid7();
  h.database.db.raw
    .prepare(
      `INSERT INTO sources (id, key, name, adapter, cadence_minutes, manual_min_interval_minutes,
         max_requests_per_run, compliance_status, created_at, updated_at)
       VALUES (?, 'synthetic-feed', 'Synthetic Feed', 'CONFIGURED_LISTING', 60, 10, 5, 'APPROVED', ?, ?)`,
    )
    .run(sourceId, now, now);
  h.database.db.raw
    .prepare(
      `INSERT INTO source_records (id, source_id, external_key, url, first_seen_at, last_seen_at,
         last_fetched_at, content_hash, payload_json, event_id)
       VALUES (?, ?, 'a', 'https://feed.example/a', ?, ?, ?, 'h', '{}', ?)`,
    )
    .run(uuid7(), sourceId, now, now, now, eventA);

  // One student on a team (event A) and alone (event B): two competitions, two events.
  shared = freshStudent(h);
  const team = await teamWith(server, h, h.alice, 'Team Rocket', [shared, freshStudent(h)]);
  const a = await assigned(server, h.alice, { eventId: eventA, teamId: team.id });
  expect((await move(server, h.alice, a, 'APPLIED')).status).toBe(200);
  await assigned(server, h.bob, {
    eventId: makeEvent(h, { title: 'Synthetic Hack B' }),
    studentIds: [shared],
  });

  // A withdrawn one: in the totals, not in the completion rate.
  const other = await teamWith(server, h, h.bob, 'Team Comet');
  const c = await assigned(server, h.bob, { eventId: makeEvent(h), teamId: other.id });
  expect((await move(server, h.bob, c, 'WITHDRAWN')).status).toBe(200);
});
afterAll(async () => {
  await server.close();
  h.close();
});

async function insights(
  query = '',
  as = h.alice,
): Promise<{ status: number; body: InsightsResponse }> {
  const response = await call(server, 'GET', `/api/v1/insights${query}`, { as });
  return { status: response.status, body: response.body as unknown as InsightsResponse };
}

describe('GET /insights', () => {
  it('reconciles the active count with the Competitions list', async () => {
    const { body } = await insights();
    const list = await call(
      server,
      'GET',
      '/api/v1/competitions?status=ASSIGNED,APPLIED,PARTICIPATING',
      { as: h.alice },
    );
    expect(body.activeNow).toBe(2);
    expect(body.activeNow).toBe(list.body.total);
  });

  it('counts the funnel with the withdrawn one kept out of the completion rate', async () => {
    const { body } = await insights();
    expect(body.funnel.total).toBe(3);
    expect(body.funnel.withdrawn).toBe(1);
    expect(body.funnel.steps.find((s) => s.status === 'ASSIGNED')?.reached).toBe(3);
    expect(body.funnel.steps.find((s) => s.status === 'APPLIED')?.reached).toBe(1);
    expect(body.funnel.completion).toEqual({ numerator: 0, denominator: 2 });
  });

  it('counts a student in two competitions for different events twice', async () => {
    const { body } = await insights();
    expect(body.students.top[0]).toMatchObject({ id: shared, count: 2 });
    expect(body.teams.distinct).toBe(2);
    expect(body.eventsByType).toEqual([{ type: 'HACKATHON', count: 3 }]);
  });

  it('credits the source behind an assigned event', async () => {
    const { body } = await insights();
    expect(body.sources).toEqual([
      expect.objectContaining({ name: 'Synthetic Feed', events: 1, assigned: 1 }),
    ]);
  });

  it('puts this month’s assignments on the chart', async () => {
    const { body } = await insights('?from=2026-10-01&to=2026-10-01');
    expect(body.participation).toEqual([{ month: '2026-10', assigned: 3, active: 2 }]);
  });

  it('shows a professor the same department-wide view as an administrator (D-03)', async () => {
    const asProfessor = await insights('', h.bob);
    const asAdmin = await insights('', h.admin);
    expect(asProfessor.status).toBe(200);
    expect(asAdmin.body).toEqual(asProfessor.body);
  });

  it('needs a session', async () => {
    const response = await call(server, 'GET', '/api/v1/insights');
    expect(response.status).toBe(401);
  });

  it.each([
    ['?from=2026-10-02&to=2026-10-01', 'from after to'],
    ['?from=2020-01-01&to=2026-10-01', 'more than five years'],
    ['?from=2026-02-30', 'not a real day'],
    ['?from=2026-1-1', 'not YYYY-MM-DD'],
  ])('refuses %s (%s)', async (query) => {
    expect((await insights(query)).status).toBe(400);
  });
});

describe('a fresh install', () => {
  it('answers with the empty state, not an error', async () => {
    const fresh = openStudentsHarness();
    const freshServer = await startStudentsServer(fresh);
    try {
      const response = await call(freshServer, 'GET', '/api/v1/insights', { as: fresh.alice });
      expect(response.status).toBe(200);
      const body = response.body as unknown as InsightsResponse;
      expect(body.isEmpty).toBe(true);
      expect(body.activeNow).toBe(0);
      expect(body.milestones).toEqual([]);
      expect(body.from).toBe('2025-11-01');
    } finally {
      await freshServer.close();
      fresh.close();
    }
  });
});

describe('/me/appearance', () => {
  it('starts at the defaults', async () => {
    const response = await call(server, 'GET', '/api/v1/me/appearance', { as: h.bob });
    expect(response.body).toEqual({
      flavourLight: 'latte',
      flavourDark: 'mocha',
      effects: 'STANDARD',
      rgbPreset: { preset: 'OFF', speed: 'MEDIUM' },
    });
  });

  it('round-trips all four keys, per user, across sessions', async () => {
    const put = await call(server, 'PUT', '/api/v1/me/appearance', {
      as: h.alice,
      body: {
        flavourLight: 'classic',
        flavourDark: 'frappe',
        effects: 'SHOWCASE',
        rgbPreset: { preset: 'AURORA', speed: 'FAST' },
      },
    });
    expect(put.status).toBe(200);
    // A later session is a new request for the same user id: nothing is session-held.
    const again = await call(server, 'GET', '/api/v1/me/appearance', { as: h.alice });
    expect(again.body).toEqual(put.body);
    expect(again.body.effects).toBe('SHOWCASE');
    const other = await call(server, 'GET', '/api/v1/me/appearance', { as: h.admin });
    expect(other.body.effects).toBe('STANDARD');
  });

  it('refuses an unknown flavour on write', async () => {
    const response = await call(server, 'PUT', '/api/v1/me/appearance', {
      as: h.alice,
      body: { flavourDark: 'neon' },
    });
    expect(response.status).toBe(400);
  });

  it('falls back to the default for a stored value it no longer knows', async () => {
    h.database.db.raw
      .prepare('UPDATE settings SET value_json = ? WHERE key = ?')
      .run(JSON.stringify({ [h.alice.id]: 'neon' }), 'appearance.flavourDark');
    const response = await call(server, 'GET', '/api/v1/me/appearance', { as: h.alice });
    expect(response.body.flavourDark).toBe('mocha');
    expect(response.body.effects).toBe('SHOWCASE');
  });
});
