import {
  EVENT_MODES,
  EVENT_TYPES,
  EventQuery,
  REG_STATES,
  SEARCH_SORTS,
  type EventQueryInput,
} from '@compintel/contracts';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openRankingCorpus, type RankingCorpus } from '../../testing/ranking-corpus.js';

/**
 * WP-24's ids-only path (`SearchService.matchingIds`) against the paged
 * `POST /search/events` it must agree with: for 50 generated queries, every
 * id paging returns — and nothing else. Hidden events are excluded by both
 * (the ids path forces `excludeHidden`), and sort, cursor and limit are moot.
 */

let corpus: RankingCorpus;
beforeAll(async () => {
  corpus = await openRankingCorpus();
});
afterAll(() => {
  corpus.h.close();
});

const queryArb: fc.Arbitrary<EventQueryInput> = fc.record(
  {
    text: fc.constantFrom('hackathon', 'ai', 'blockchain summit', 'ackath', 'hackthon', 'zzzz'),
    eventTypes: fc.uniqueArray(fc.constantFrom(...EVENT_TYPES), { minLength: 1, maxLength: 3 }),
    modes: fc.uniqueArray(fc.constantFrom(...EVENT_MODES), { minLength: 1, maxLength: 3 }),
    categories: fc.uniqueArray(fc.constantFrom('ai-ml', 'blockchain', 'cybersecurity-ctf', 'web'), {
      minLength: 1,
      maxLength: 2,
    }),
    maxDistanceKm: fc.constantFrom(50, 100, 250, 500),
    registration: fc.record({
      states: fc.uniqueArray(fc.constantFrom(...REG_STATES), { minLength: 1, maxLength: 3 }),
    }),
    teamSizeFits: fc.integer({ min: 1, max: 6 }),
    includeUnknown: fc.record({ deadline: fc.boolean(), location: fc.boolean() }),
    includeEnded: fc.boolean(),
    sort: fc.constantFrom(...SEARCH_SORTS),
  },
  { requiredKeys: [] },
);

function pagedIds(query: EventQueryInput): string[] {
  const ids: string[] = [];
  let body: EventQueryInput = { ...query, excludeHidden: true, limit: 100 };
  for (;;) {
    const response = corpus.h.query({ ...body, facets: false }, corpus.professor);
    ids.push(...response.items.map((item) => item.id));
    if (response.nextCursor === undefined) return ids;
    body = { ...body, cursor: response.nextCursor };
  }
}

describe('matchingIds — the same set as paging the search', () => {
  it('agrees for 50 generated queries', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        const expected = pagedIds(query);
        const actual = corpus.h.search.service.matchingIds(
          corpus.professor.id,
          EventQuery.parse(query),
        );
        expect(new Set(actual)).toStrictEqual(new Set(expected));
        expect(actual).toHaveLength(new Set(actual).size);
      }),
      { numRuns: 50, seed: 2024 },
    );
  });

  it('excludes what the owner hid even when the query does not ask', () => {
    const ids = corpus.h.search.service.matchingIds(
      corpus.professor.id,
      EventQuery.parse({ excludeHidden: false }),
    );
    expect(ids).not.toContain(corpus.hidden.user);
    expect(ids).not.toContain(corpus.hidden.admin);
    expect(new Set(ids)).toStrictEqual(new Set(pagedIds({})));
    expect(pagedIds({ includeEnded: true })).toHaveLength(corpus.visibleCount - 1);
  });
});
