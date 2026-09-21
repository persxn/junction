import {
  problemType,
  SearchRequest,
  type EventCategoriesResult,
  type Facets,
  type RankedEventListItem,
  type SearchResponse,
  type SourceStatusResponse,
} from '@compintel/contracts';
import { vi } from 'vitest';

import { NOW } from './clock.js';
import { detailFixture, OLDER_HISTORY } from './event-detail.js';

/**
 * A stand-in for `/search/events`, the Save/Hide routes and — since WP-16b —
 * the drawer's `/events/:id/detail`, its change history, its category override
 * and `/sources/status`, for the Discover tests. It answers in the contract's shapes (every response passes the zod
 * schema the client parses with), pages by an offset cursor, filters by the
 * handful of fields the tests use, and remembers saves and hides — so the
 * optimistic UI is checked against a server that really changed.
 */

export { NOW };
const DAY = 86_400_000;

export function makeItem(
  index: number,
  overrides: Partial<RankedEventListItem> = {},
): RankedEventListItem {
  return {
    id: `0192a000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`,
    title: `Event ${String(index)}`,
    organizerName: `Organizer ${String(index)}`,
    eventType: 'HACKATHON',
    mode: 'OFFLINE',
    distanceKm: 100 + index,
    registrationDeadlineAt: NOW + (10 + index) * DAY,
    registrationDeadlinePrecision: 'DATE',
    startsAt: NOW + (15 + index) * DAY,
    datePrecision: 'DATE',
    prize: { text: null, totalMinor: 5_000_000, currency: 'INR' },
    teamMin: 2,
    teamMax: 4,
    sources: ['devfolio'],
    hasConflicts: false,
    watchlisted: false,
    score: 10,
    reasons: [
      { code: 'REGISTRATION_OPEN', text: 'Registration open until 2 Oct', weightApplied: 10 },
    ],
    ...overrides,
  };
}

/** One source, up to date — enough for the pill to say "Updated 4 min ago". */
const SOURCE_STATUS: SourceStatusResponse = {
  sources: [
    {
      key: 'devfolio',
      name: 'Devfolio',
      adapter: 'DEVFOLIO',
      isEnabled: true,
      health: 'OK',
      lastRunAt: new Date(NOW - 4 * 60_000).toISOString(),
      lastSuccessAt: new Date(NOW - 4 * 60_000).toISOString(),
      freshnessMinutes: 4,
      nextAttemptAt: new Date(NOW + 11 * 60_000).toISOString(),
      consecutiveFailures: 0,
      lastOutcome: 'SUCCESS',
      lastErrorKind: null,
      message: 'Devfolio is up to date.',
      attributionText: 'Listing data from Devfolio.',
    },
  ],
  updatedAt: new Date(NOW - 4 * 60_000).toISOString(),
  offline: false,
};

const EMPTY_FACETS: Facets = {
  eventType: [{ value: 'HACKATHON', label: 'Hackathon', count: 0 }],
  category: [{ value: 'ai-ml', label: 'AI/ML', count: 0 }],
  mode: [{ value: 'OFFLINE', label: 'In person', count: 0 }],
  registrationState: [{ value: 'OPEN', label: 'Open', count: 0 }],
  distanceBucket: [{ value: 'ANYWHERE', label: 'Anywhere', count: 0 }],
};

export interface SearchCall {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

export interface FakeSearch {
  readonly calls: SearchCall[];
  /** The category set the last `PUT /events/:id/categories` carried. */
  readonly categorySets: string[][];
  readonly saved: Set<string>;
  readonly hidden: Set<string>;
  /** The next request to a path matching this answers 500 (not retryable), after `delayMs`. */
  failNext(path: RegExp, delayMs?: number): void;
  /** Search requests only, parsed. */
  searches(): Record<string, unknown>[];
}

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

export function installFakeSearch(items: readonly RankedEventListItem[]): FakeSearch {
  const calls: SearchCall[] = [];
  const categorySets: string[][] = [];
  let categories = detailFixture().categories;
  const saved = new Set(items.filter((item) => item.watchlisted).map((item) => item.id));
  const hidden = new Set<string>();
  const failures: { path: RegExp; delayMs: number }[] = [];

  const search = (raw: Record<string, unknown>): SearchResponse => {
    const request = SearchRequest.parse(raw);
    const matching = items
      .filter((item) => !(request.excludeHidden === true && hidden.has(item.id)))
      .filter(
        (item) => request.eventTypes === undefined || request.eventTypes.includes(item.eventType),
      )
      .filter((item) => request.modes === undefined || request.modes.includes(item.mode))
      .filter(
        (item) =>
          request.text === undefined ||
          item.title.toLowerCase().includes(request.text.toLowerCase()),
      )
      .map((item) => ({ ...item, watchlisted: saved.has(item.id) }));
    const offset = request.cursor === undefined ? 0 : Number(request.cursor);
    const page = matching.slice(offset, offset + request.limit);
    const next = offset + request.limit;
    return {
      items: page,
      total: matching.length,
      totalIsApproximate: false,
      ...(next < matching.length ? { nextCursor: String(next) } : {}),
      ...(request.facets === false
        ? {}
        : {
            facets: {
              ...EMPTY_FACETS,
              eventType: [{ value: 'HACKATHON', label: 'Hackathon', count: matching.length }],
            },
          }),
    };
  };

  const fetchStub = vi.fn((url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ method, path, body });
    const failure = failures.findIndex((entry) => entry.path.test(path));
    if (failure !== -1) {
      const [{ delayMs } = { delayMs: 0 }] = failures.splice(failure, 1);
      const answer = respond(500, {
        type: problemType('INTERNAL'),
        title: 'Something went wrong',
        status: 500,
        code: 'INTERNAL',
        detail: 'The server failed while saving.',
        retryable: false,
        requestId: '0199a0d4-7c3a-7b21-9a4e-000000000009',
      });
      return new Promise<Response>((resolve) =>
        setTimeout(() => {
          resolve(answer);
        }, delayMs),
      );
    }
    if (path === '/api/v1/search/events') return Promise.resolve(respond(200, search(body ?? {})));

    // WP-16b: the drawer, its "load older" page, its override, and the pill.
    if (path === '/api/v1/sources/status') {
      return Promise.resolve(respond(200, SOURCE_STATUS));
    }
    const detail = /^\/api\/v1\/events\/([^/]+)\/detail$/.exec(path);
    if (detail !== null) {
      const found = items.find((item) => item.id === detail[1]);
      return Promise.resolve(
        respond(
          200,
          detailFixture({
            id: detail[1]!,
            ...(found === undefined
              ? {}
              : {
                  title: found.title,
                  organizerName: found.organizerName,
                  hasConflicts: found.hasConflicts,
                  ...(found.hasConflicts ? {} : { conflicts: [] }),
                }),
            categories,
          }),
        ),
      );
    }
    if (/^\/api\/v1\/events\/[^/]+\/changes$/.test(path)) {
      return Promise.resolve(respond(200, { items: OLDER_HISTORY, nextCursor: null }));
    }
    const override = /^\/api\/v1\/events\/([^/]+)\/categories$/.exec(path);
    if (override !== null && method === 'PUT') {
      const wanted = (body?.categoryIds ?? []) as string[];
      categorySets.push(wanted);
      categories = categories.map((category) => ({
        ...category,
        origin: wanted.includes(category.id) ? ('MANUAL' as const) : category.origin,
        isSuppressed: !wanted.includes(category.id),
      }));
      const result: EventCategoriesResult = {
        categories,
        version: Number(body?.version ?? 1) + 1,
      };
      return Promise.resolve(respond(200, result));
    }

    const match = /^\/api\/v1\/events\/([^/]+)\/(watchlist|hide|unhide)$/.exec(path);
    if (match !== null) {
      const [, id = '', action] = match;
      if (action === 'watchlist' && method === 'PUT') {
        saved.add(id);
        return Promise.resolve(respond(200, { eventId: id, note: null, addedAt: NOW }));
      }
      if (action === 'watchlist' && method === 'DELETE') {
        saved.delete(id);
        return Promise.resolve(respond(204, undefined));
      }
      if (action === 'hide') hidden.add(id);
      if (action === 'unhide') hidden.delete(id);
      return Promise.resolve(
        respond(200, { eventId: id, hidden: action === 'hide', hiddenReason: null }),
      );
    }
    return Promise.resolve(
      respond(404, {
        type: problemType('NOT_FOUND'),
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        requestId: 'x',
      }),
    );
  });
  vi.stubGlobal('fetch', fetchStub);

  return {
    calls,
    categorySets,
    saved,
    hidden,
    failNext: (path, delayMs = 0) => {
      failures.push({ path, delayMs });
    },
    searches: () =>
      calls.filter((call) => call.path === '/api/v1/search/events').map((call) => call.body ?? {}),
  };
}
