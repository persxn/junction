import type { EventQueryInput, EventType, Facets, RegState } from '@compintel/contracts';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openRankingCorpus, type RankingCorpus } from '../../testing/ranking-corpus.js';

/**
 * Facet counts (§8.2, WP-15b step 6). The counting rule under test: a value's
 * count is the number of results the query returns with that family's filter
 * set to exactly that value, everything else unchanged — and nothing hidden is
 * ever counted.
 */

let corpus: RankingCorpus;
beforeAll(async () => {
  corpus = await openRankingCorpus();
});
afterAll(() => {
  corpus.h.close();
});

type Family = keyof Facets;

/** `query` with `family` filtered to exactly `value`. */
function applied(query: EventQueryInput, family: Family, value: string): EventQueryInput {
  switch (family) {
    case 'eventType':
      return { ...query, eventTypes: [value as EventType] };
    case 'mode':
      return { ...query, modes: [value as 'ONLINE'] };
    case 'category':
      return { ...query, categories: [value] };
    case 'registrationState':
      return { ...query, registration: { ...query.registration, states: [value as RegState] } };
    case 'distanceBucket': {
      const { maxDistanceKm: _dropped, ...rest } = query;
      return value === 'ANYWHERE' ? rest : { ...rest, maxDistanceKm: Number(value) };
    }
  }
}

function facetsOf(query: EventQueryInput): Facets {
  const facets = corpus.h.query({ ...query, limit: 1 }, corpus.professor).facets;
  if (facets === undefined) throw new Error('facets missing');
  return facets;
}

function assertCountsMatchResults(query: EventQueryInput): void {
  const facets = facetsOf(query);
  for (const family of Object.keys(facets) as Family[]) {
    for (const entry of facets[family]) {
      const total = corpus.h.query(
        { ...applied(query, family, entry.value), limit: 1, facets: false },
        corpus.professor,
      ).total;
      expect({ family, value: entry.value, count: entry.count }).toEqual({
        family,
        value: entry.value,
        count: total,
      });
    }
  }
}

describe('each count equals the results that value would return', () => {
  it.each<[string, EventQueryInput]>([
    ['no filters', {}],
    ['a mode and a radius', { modes: ['OFFLINE', 'HYBRID'], maxDistanceKm: 250 }],
    ['online admitted by the radius', { modes: ['ONLINE', 'OFFLINE'], maxDistanceKm: 100 }],
    ['unknown location admitted', { maxDistanceKm: 500, includeUnknown: { location: true } }],
    [
      'registration states with unknown deadlines',
      { registration: { states: ['OPEN'] }, includeUnknown: { deadline: true } },
    ],
    [
      'a deadline range',
      { registration: { deadlineFrom: '2026-09-25', deadlineTo: '2026-10-31' } },
    ],
    ['text', { text: 'hackathon' }],
    ['a category and a type', { categories: ['ai-ml'], eventTypes: ['HACKATHON', 'CTF'] }],
    ['user-hidden excluded', { excludeHidden: true, includeEnded: true }],
  ])('%s', (_name, query) => {
    assertCountsMatchResults(query);
  });

  it('holds over generated queries', () => {
    const arb = fc.record(
      {
        eventTypes: fc.uniqueArray(fc.constantFrom<EventType>('HACKATHON', 'CTF', 'IDEATHON'), {
          minLength: 1,
          maxLength: 2,
        }),
        modes: fc.uniqueArray(fc.constantFrom('ONLINE', 'OFFLINE', 'HYBRID', 'UNKNOWN' as const), {
          minLength: 1,
          maxLength: 2,
        }),
        maxDistanceKm: fc.constantFrom(50, 250, 500),
        registration: fc.record({
          states: fc.uniqueArray(
            fc.constantFrom<RegState>('OPEN', 'CLOSING_SOON', 'UNKNOWN', 'CLOSED'),
            { minLength: 1, maxLength: 2 },
          ),
        }),
        includeUnknown: fc.record({ deadline: fc.boolean(), location: fc.boolean() }),
        categories: fc.constant<string[]>(['blockchain']),
        excludeHidden: fc.boolean(),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(arb, (query) => {
        assertCountsMatchResults(query);
      }),
      { numRuns: 25 },
    );
  });
});

describe('what is never counted', () => {
  it('POLICY_HIDDEN, ADMIN_HIDDEN and MERGED events are absent from every count', () => {
    // The corpus's only OTHER events are the hidden ones plus one the professor hid.
    const facets = facetsOf({ includeEnded: true });
    expect(facets.eventType.find((entry) => entry.value === 'OTHER')?.count).toBe(1);
    const total = corpus.h.query({ includeEnded: true, limit: 1 }, corpus.professor).total;
    expect(facets.eventType.reduce((sum, entry) => sum + entry.count, 0)).toBe(total);
    expect(facets.mode.reduce((sum, entry) => sum + entry.count, 0)).toBe(total);
    expect(facets.registrationState.reduce((sum, entry) => sum + entry.count, 0)).toBe(total);
  });

  it('a user-hidden event leaves the counts once excludeHidden is set', () => {
    const facets = facetsOf({ includeEnded: true, excludeHidden: true });
    expect(facets.eventType.find((entry) => entry.value === 'OTHER')?.count).toBe(0);
  });
});

describe('shape', () => {
  it('no matches → every family present, every count zero', () => {
    const facets = facetsOf({ text: 'zzzqqq' });
    expect(Object.keys(facets).sort()).toEqual([
      'category',
      'distanceBucket',
      'eventType',
      'mode',
      'registrationState',
    ]);
    expect(facets.eventType).toHaveLength(6);
    expect(facets.mode).toHaveLength(4);
    expect(facets.registrationState).toHaveLength(5);
    expect(facets.category).toHaveLength(12);
    expect(facets.distanceBucket.map((entry) => entry.value)).toEqual([
      '50',
      '100',
      '250',
      '500',
      'ANYWHERE',
    ]);
    for (const family of Object.values(facets)) {
      expect(family.every((entry) => entry.count === 0)).toBe(true);
    }
  });

  it('labels read as the UI shows them; buckets are cumulative', () => {
    const facets = facetsOf({});
    expect(facets.mode.map((entry) => entry.label)).toEqual([
      'Online',
      'In person',
      'Hybrid',
      'Mode unknown',
    ]);
    expect(facets.distanceBucket[0]?.label).toBe('Within 50 km');
    const counts = facets.distanceBucket.map((entry) => entry.count);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(facets.category[0]?.count).toBeGreaterThanOrEqual(facets.category[1]?.count ?? 0);
  });

  it('`facets: false` skips them', () => {
    expect(corpus.h.query({ facets: false }, corpus.professor).facets).toBeUndefined();
  });
});
