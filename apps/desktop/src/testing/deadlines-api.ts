import {
  URGENCY_BUCKETS,
  type DueItem,
  type KpiTile,
  type UrgencyBucket,
} from '@compintel/contracts';
import { vi } from 'vitest';

/**
 * The WP-22 backend for its screens, in memory (D-33): the Radar's items with
 * the server's buckets, filtered and counted the way `GET /deadlines` does, and
 * the KPI tiles a test supplies. Everything else goes to the fake before it.
 */

export interface DeadlinesApi {
  readonly calls: { path: string; query: URLSearchParams }[];
}

let serial = 0;
export function makeDueItem(bucket: UrgencyBucket, patch: Partial<DueItem> = {}): DueItem {
  serial += 1;
  return {
    id: `task:${String(serial)}`,
    itemKind: 'TASK',
    deadlineKind: null,
    label: `Thing ${String(serial)}`,
    dueAt: '2026-10-09T12:00:00.000Z',
    precision: 'DATETIME',
    bucket,
    daysLeft: 0,
    eventId: '0192f0c1-0000-7000-8000-00000000d001',
    eventTitle: 'Synthetic Hack',
    engagementId: '0192f0c1-0000-7000-8000-00000000e001',
    competitionName: 'Team Rocket — Synthetic Hack',
    teamId: '0192f0c1-0000-7000-8000-00000000b001',
    teamName: 'Team Rocket',
    stageId: null,
    taskId: null,
    sourceLabel: 'Task',
    ...patch,
  };
}

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

export function installDeadlinesApi(
  options: { items?: DueItem[]; tiles?: KpiTile[]; failDeadlines?: boolean } = {},
): DeadlinesApi {
  const delegate = globalThis.fetch;
  const calls: DeadlinesApi['calls'] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/api/v1/deadlines') {
        calls.push({ path: parsed.pathname, query: parsed.searchParams });
        if (options.failDeadlines === true) {
          return Promise.resolve(
            respond(500, {
              type: 'urn:compintel:problem:INTERNAL',
              title: 'Something went wrong',
              status: 500,
              code: 'INTERNAL',
              requestId: 'r',
            }),
          );
        }
        const q = parsed.searchParams;
        const filtered = (options.items ?? []).filter(
          (item) =>
            (q.get('itemKind') === null || item.itemKind === q.get('itemKind')) &&
            (q.get('group') === null ||
              (q.get('group') === 'EVENTS') === (item.itemKind === 'EVENT_DEADLINE')),
        );
        const counts = Object.fromEntries(
          URGENCY_BUCKETS.map((bucket) => [
            bucket,
            filtered.filter((item) => item.bucket === bucket).length,
          ]),
        );
        const chosen =
          q.get('bucket') === null
            ? filtered
            : filtered.filter((item) => item.bucket === q.get('bucket'));
        return Promise.resolve(
          respond(200, { items: chosen, counts, total: chosen.length, nextCursor: null }),
        );
      }
      if (parsed.pathname === '/api/v1/dashboard/kpis') {
        calls.push({ path: parsed.pathname, query: parsed.searchParams });
        return Promise.resolve(respond(200, { tiles: options.tiles ?? [] }));
      }
      return delegate(url, init);
    }),
  );
  return { calls };
}
