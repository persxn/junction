import { DEFAULT_APPEARANCE, type Appearance, type InsightsResponse } from '@compintel/contracts';
import { vi } from 'vitest';

/**
 * WP-33's backend for its screens, in memory (D-33): `GET /insights` and the
 * caller's appearance. Everything else goes to whatever fake was installed first.
 */

export function makeInsights(patch: Partial<InsightsResponse> = {}): InsightsResponse {
  return {
    from: '2025-11-01',
    to: '2026-10-10',
    isEmpty: false,
    activeNow: 3,
    participation: [
      { month: '2026-08', assigned: 2, active: 2 },
      { month: '2026-09', assigned: 0, active: 1 },
      { month: '2026-10', assigned: 1, active: 3 },
    ],
    eventsByType: [
      { type: 'HACKATHON', count: 2 },
      { type: 'CTF', count: 1 },
    ],
    eventsByMode: [{ mode: 'ONLINE', count: 3 }],
    funnel: {
      steps: [
        { status: 'CONSIDERING', reached: 4 },
        { status: 'ASSIGNED', reached: 4 },
        { status: 'APPLIED', reached: 3 },
        { status: 'PARTICIPATING', reached: 2 },
        { status: 'COMPLETED', reached: 1 },
      ],
      total: 4,
      withdrawn: 1,
      notSelected: 0,
      completion: { numerator: 1, denominator: 3 },
    },
    outcomes: [
      { result: 'WINNER', count: 1 },
      { result: 'PARTICIPATED', count: 0 },
    ] as InsightsResponse['outcomes'],
    students: { distinct: 5, top: [{ id: 's1', name: 'Asha Rao', count: 2 }] },
    teams: { distinct: 2, top: [{ id: 't1', name: 'Team Rocket', count: 2 }] },
    mentors: [
      {
        userId: '0192f0c1-0000-7000-8000-00000000a001',
        name: 'Alice Professor',
        active: 2,
        total: 3,
      },
    ],
    deadlines: { met: 4, missed: 1, undated: 2 },
    sources: [{ sourceId: 'src1', name: 'Synthetic Feed', events: 6, assigned: 2 }],
    streaks: { activeWeeks: 9, weeksInRange: 50, longest: 6, current: 2 },
    milestones: [
      {
        kind: 'FIRST_WINNER',
        id: 'FIRST_WINNER',
        at: '2026-09-12T00:00:00.000Z',
        title: 'First win recorded',
      },
    ],
    ...patch,
  };
}

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

export interface InsightsApi {
  readonly queries: URLSearchParams[];
  readonly saved: unknown[];
}

export function installInsightsApi(
  options: { insights?: InsightsResponse; appearance?: Appearance } = {},
): InsightsApi {
  const delegate = globalThis.fetch;
  const api: InsightsApi = { queries: [], saved: [] };
  let appearance = options.appearance ?? DEFAULT_APPEARANCE;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v1/insights') {
        api.queries.push(parsed.searchParams);
        return Promise.resolve(respond(200, options.insights ?? makeInsights()));
      }
      if (parsed.pathname === '/api/v1/me/appearance') {
        if (init?.method === 'PUT') {
          const body: unknown = JSON.parse(init.body as string);
          api.saved.push(body);
          appearance = { ...appearance, ...(body as Partial<Appearance>) };
        }
        return Promise.resolve(respond(200, appearance));
      }
      return delegate(url, init);
    }),
  );
  return api;
}
