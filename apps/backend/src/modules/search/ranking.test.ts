import {
  EVENT_MODES,
  EVENT_TYPES,
  REG_STATES,
  SEARCH_SORTS,
  SearchResponse,
  type SearchRequestInput,
} from '@compintel/contracts';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openRankingCorpus, type RankingCorpus } from '../../testing/ranking-corpus.js';
import { openSearchHarness, SEARCH_NOW, type SearchHarness } from '../../testing/search.js';
import { compareRelevance } from './domain/rank.js';
import { RANKING_WEIGHTS } from './settings.js';

/**
 * WP-15b's acceptance criterion and the ranking's contract over a real
 * database: every ranked result carries at least one reason, the reasons are
 * the right ones, and the order is deterministic and moves with its settings.
 */

const DAY = 86_400_000;
const NOW = Date.parse(SEARCH_NOW);

let corpus: RankingCorpus;
beforeAll(async () => {
  corpus = await openRankingCorpus();
});
afterAll(() => {
  corpus.h.close();
});

const queryArb: fc.Arbitrary<SearchRequestInput> = fc.record(
  {
    text: fc.constantFrom(
      'hackathon',
      'ai',
      'blockchain summit',
      'robotics',
      'ackath',
      'hackthon',
      'zzzz',
    ),
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
    includeUnknown: fc.record({
      deadline: fc.boolean(),
      location: fc.boolean(),
      teamSize: fc.boolean(),
    }),
    includeEnded: fc.boolean(),
    excludeHidden: fc.boolean(),
    sort: fc.constantFrom(...SEARCH_SORTS),
    limit: fc.integer({ min: 1, max: 25 }),
    facets: fc.boolean(),
  },
  { requiredKeys: [] },
);

describe('the acceptance criterion: every ranked result carries at least one reason', () => {
  it('holds for every sort, with and without text, over generated queries — every page', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        let body: SearchRequestInput = query;
        for (let page = 0; page < 4; page += 1) {
          const response = corpus.h.query(body, corpus.professor);
          expect(SearchResponse.safeParse(response).success).toBe(true);
          for (const item of response.items) {
            expect(item.reasons.length).toBeGreaterThanOrEqual(1);
            expect(item.score).toBeCloseTo(
              item.reasons.reduce((sum, reason) => sum + reason.weightApplied, 0),
              6,
            );
          }
          if ((query.sort ?? 'RELEVANCE') === 'RELEVANCE') {
            // SQL ordered the rows (score-sql.ts); rank.ts explained them. The two
            // must agree: the explained scores are in RELEVANCE order.
            const keys = response.items.map((item) => ({
              score: item.score,
              deadline: item.registrationDeadlineAt,
              id: item.id,
            }));
            for (let i = 1; i < keys.length; i += 1) {
              expect(compareRelevance(keys[i - 1]!, keys[i]!)).toBeLessThan(0);
            }
          }
          if (response.nextCursor === undefined) break;
          body = { ...query, cursor: response.nextCursor };
        }
      }),
      { numRuns: 150 },
    );
  });

  it('holds on the plain feed for every sort (no filters at all)', () => {
    for (const sort of SEARCH_SORTS) {
      const response = corpus.h.query({ sort, limit: 100 }, corpus.professor);
      expect(response.items.length).toBeGreaterThan(40);
      expect(response.items.every((item) => item.reasons.length > 0)).toBe(true);
    }
  });
});

describe('determinism', () => {
  it('the same query twice gives the same order, scores and reasons', () => {
    for (const text of [undefined, 'hackathon']) {
      const body = { limit: 100, ...(text === undefined ? {} : { text }) };
      expect(corpus.h.query(body, corpus.professor)).toEqual(
        corpus.h.query(body, corpus.professor),
      );
    }
  });

  it('RELEVANCE pages cover every row exactly once, in the one-shot order', () => {
    const all = corpus.h
      .query({ limit: 100, facets: false }, corpus.professor)
      .items.map((item) => item.id);
    const paged: string[] = [];
    let cursor: string | undefined;
    do {
      const response = corpus.h.query(
        { limit: 7, facets: false, ...(cursor === undefined ? {} : { cursor }) },
        corpus.professor,
      );
      paged.push(...response.items.map((item) => item.id));
      cursor = response.nextCursor;
    } while (cursor !== undefined);
    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(paged.length);
  });
});

describe('order and settings', () => {
  let h: SearchHarness;
  beforeAll(() => {
    h = openSearchHarness();
  });
  afterAll(() => {
    h.close();
  });

  it('raising a weight moves the events that fire it up; zeroing one moves them down', () => {
    // "Agree": registration open (10) + sources agree (5) = 15.
    // "Soon": closing soon (15), sources disagree = 15. The tie breaks on deadline: Soon first.
    h.add({
      title: 'Agree',
      hasConflicts: false,
      registrationDeadlineAt: NOW + 20 * DAY,
      registrationDeadlinePrecision: 'DATE',
      firstSeenAt: NOW - 30 * DAY,
    });
    h.add({
      title: 'Soon',
      hasConflicts: true,
      registrationDeadlineAt: NOW + 3 * DAY,
      registrationDeadlinePrecision: 'DATE',
      firstSeenAt: NOW - 30 * DAY,
    });
    expect(h.titles({})).toEqual(['Soon', 'Agree']);

    h.setSetting(RANKING_WEIGHTS, { ...RANKING_WEIGHTS.default, noConflicts: 20 });
    expect(h.titles({})).toEqual(['Agree', 'Soon']);

    h.setSetting(RANKING_WEIGHTS, { ...RANKING_WEIGHTS.default, closingSoon: 30 });
    expect(h.titles({})).toEqual(['Soon', 'Agree']);

    h.setSetting(RANKING_WEIGHTS, { ...RANKING_WEIGHTS.default, closingSoon: 0 });
    expect(h.titles({})).toEqual(['Agree', 'Soon']);
    const soon = h.query({}).items.find((item) => item.title === 'Soon');
    expect(soon?.reasons).toContainEqual({
      code: 'CLOSING_SOON',
      text: 'Registration closes in 3 days (25 Sep)',
      weightApplied: 0,
    });
    h.setSetting(RANKING_WEIGHTS, RANKING_WEIGHTS.default);
  });

  it('ties break by deadline, then id — identically on every run', () => {
    const tie = h.user('PROFESSOR');
    const ids = ['T3', 'T1', 'T2'].map((title) =>
      h.add({
        title,
        hasConflicts: true,
        firstSeenAt: NOW - 30 * DAY,
        registrationDeadlineAt: NOW + 30 * DAY,
        registrationDeadlinePrecision: 'DATE',
      }),
    );
    const run = (): string[] =>
      h
        .query({ limit: 100 }, tie)
        .items.filter((item) => ids.includes(item.id))
        .map((item) => item.id);
    expect(run()).toEqual([...ids].sort());
    expect(run()).toEqual(run());
  });
});

describe('reasons in the integrated path', () => {
  let h: SearchHarness;
  beforeAll(async () => {
    h = openSearchHarness();
    h.campus(13.0827, 80.2707);
    h.seedCategories();
    await h.classifyAll();
  });
  afterAll(() => {
    h.close();
  });

  it('a 400 km event under a 500 km filter says "~400 km (straight line)"', () => {
    // 400 km due north of the campus.
    h.add({
      title: 'Far North Hackathon',
      mode: 'OFFLINE',
      lat: 13.0827 + 400 / 111.195,
      lon: 80.2707,
      geoPrecision: 'CITY',
    });
    const item = h
      .query({ maxDistanceKm: 500 })
      .items.find((candidate) => candidate.title === 'Far North Hackathon');
    expect(item?.reasons).toContainEqual({
      code: 'WITHIN_RADIUS',
      text: '~400 km (straight line)',
      weightApplied: 10,
    });
  });

  it('interests: a category and a tag the professor follows are named', async () => {
    const professor = h.user('PROFESSOR');
    h.interest(professor, 'AI/ML');
    h.interest(professor, 'Rust');
    const id = h.add({ title: 'GenAI Rust Hackathon' });
    h.tagEvent(id, 'Rust');
    await h.classifyAll();
    const item = h.query({ text: 'rust' }, professor).items[0];
    expect(item?.reasons.map((reason) => reason.text)).toEqual(
      expect.arrayContaining([
        'AI/ML matches your interests',
        'Tagged Rust, one of your interests',
      ]),
    );
    const stranger = h.user('PROFESSOR');
    expect(
      h.query({ text: 'rust' }, stranger).items[0]?.reasons.map((reason) => reason.code),
    ).not.toContain('CATEGORY_MATCH');
  });

  it('the categories and tags filters work now that both are stored', async () => {
    h.add({ title: 'Solana Blockchain Summit' });
    const tagged = h.add({ title: 'Untitled meetup' });
    h.tagEvent(tagged, 'Solidity');
    await h.classifyAll();
    expect(h.titles({ categories: ['blockchain'] })).toEqual(['Solana Blockchain Summit']);
    expect(h.titles({ tags: ['solidity'] })).toEqual(['Untitled meetup']);
    expect(h.titles({ categories: ['no-such-category'] })).toEqual([]);
  });

  it('the event detail lists its categories', () => {
    const id = h.query({ text: 'solana' }).items[0]?.id ?? '';
    expect(h.search.service.detail({ actor: h.user('PROFESSOR') }, id).categories).toEqual([
      expect.objectContaining({ slug: 'blockchain', name: 'Blockchain' }),
    ]);
  });
});
