import { describe, expect, it } from 'vitest';

import {
  AliasTerm,
  EventListItem,
  EventQuery,
  IsoDate,
  SEARCH_LIMIT_DEFAULT,
  SearchAliasInput,
  SearchResponse,
  SpellingCorrection,
} from './search.js';

/**
 * `EventQuery` is the one query model (§8.1): the filter UI, saved searches and
 * the M4 AI planner all build it, so every field and every rule is pinned here.
 */

const ok = (value: unknown): boolean => EventQuery.safeParse(value).success;
const UUID = '01920000-0000-7000-8000-000000000001';

describe('EventQuery — the whole object', () => {
  it('accepts an empty query and fills limit with 25', () => {
    expect(EventQuery.parse({})).toEqual({ limit: SEARCH_LIMIT_DEFAULT });
  });

  it('is strict: an unknown key fails rather than being dropped', () => {
    expect(ok({ text: 'x', eventType: ['CTF'] })).toBe(false);
    expect(ok({ registration: { state: ['OPEN'] } })).toBe(false);
    expect(ok({ includeUnknown: { prize: true } })).toBe(false);
    expect(ok({ feeMax: { minor: 1, currency: 'INR', symbol: '₹' } })).toBe(false);
  });

  it('accepts every §8.1 field at once', () => {
    expect(
      ok({
        text: 'ml hackathon',
        eventTypes: ['HACKATHON', 'CTF'],
        categories: ['ai-ml'],
        tags: ['python'],
        modes: ['OFFLINE', 'ONLINE'],
        maxDistanceKm: 250,
        registration: { states: ['OPEN'], deadlineFrom: '2026-09-01', deadlineTo: '2026-10-01' },
        eventDate: { from: '2026-10-01', to: '2026-10-31' },
        organizerKinds: ['IIT'],
        institutionIds: [UUID],
        freeOnly: false,
        feeMax: { minor: 50_000, currency: 'INR' },
        prizeMin: { minor: 100_000_00, currency: 'INR' },
        teamSizeFits: 3,
        includeUnknown: { fee: true, teamSize: true, location: false, deadline: true },
        includeRecurring: true,
        includeEnded: false,
        watchlistedOnly: false,
        excludeHidden: true,
        sort: 'DEADLINE',
        cursor: 'abc.def',
        limit: 50,
      }),
    ).toBe(true);
  });
});

describe('EventQuery — field by field', () => {
  it('text: up to 200 characters', () => {
    expect(ok({ text: 'a'.repeat(200) })).toBe(true);
    expect(ok({ text: 'a'.repeat(201) })).toBe(false);
    expect(ok({ text: 42 })).toBe(false);
  });

  it('limit: 1–100, integers only', () => {
    expect(ok({ limit: 1 })).toBe(true);
    expect(ok({ limit: 100 })).toBe(true);
    expect(ok({ limit: 0 })).toBe(false);
    expect(ok({ limit: 101 })).toBe(false);
    expect(ok({ limit: 2.5 })).toBe(false);
  });

  it('eventTypes, modes, organizerKinds: closed enums, non-empty lists', () => {
    expect(ok({ eventTypes: ['QUIZ'] })).toBe(false);
    expect(ok({ eventTypes: [] })).toBe(false);
    expect(ok({ modes: ['REMOTE'] })).toBe(false);
    expect(ok({ organizerKinds: ['SCHOOL'] })).toBe(false);
    expect(ok({ organizerKinds: ['NIT', 'IIIT'] })).toBe(true);
  });

  it('categories and tags: non-empty labels', () => {
    expect(ok({ categories: [''] })).toBe(false);
    expect(ok({ tags: ['   '] })).toBe(false);
    expect(ok({ tags: ['x'.repeat(101)] })).toBe(false);
  });

  it('institutionIds: UUIDv7 only', () => {
    expect(ok({ institutionIds: ['not-a-uuid'] })).toBe(false);
  });

  it('maxDistanceKm: positive, and not beyond half the planet', () => {
    expect(ok({ maxDistanceKm: 50 })).toBe(true);
    expect(ok({ maxDistanceKm: 0 })).toBe(false);
    expect(ok({ maxDistanceKm: -5 })).toBe(false);
    expect(ok({ maxDistanceKm: 30_000 })).toBe(false);
  });

  it('money: minor units ≥ 0 with an ISO currency', () => {
    expect(ok({ feeMax: { minor: 0, currency: 'INR' } })).toBe(true);
    expect(ok({ feeMax: { minor: -1, currency: 'INR' } })).toBe(false);
    expect(ok({ feeMax: { minor: 1.5, currency: 'INR' } })).toBe(false);
    expect(ok({ prizeMin: { minor: 100, currency: 'inr' } })).toBe(false);
    expect(ok({ prizeMin: { minor: 100 } })).toBe(false);
  });

  it('teamSizeFits: a positive integer', () => {
    expect(ok({ teamSizeFits: 4 })).toBe(true);
    expect(ok({ teamSizeFits: 0 })).toBe(false);
    expect(ok({ teamSizeFits: 2.5 })).toBe(false);
  });

  it('booleans are booleans', () => {
    for (const key of [
      'freeOnly',
      'includeRecurring',
      'includeEnded',
      'watchlistedOnly',
      'excludeHidden',
    ]) {
      expect(ok({ [key]: true }), key).toBe(true);
      expect(ok({ [key]: 'yes' }), key).toBe(false);
    }
  });

  it('sort: the six §8.1 values', () => {
    for (const sort of ['RELEVANCE', 'DEADLINE', 'START', 'DISTANCE', 'PRIZE', 'NEWEST']) {
      expect(ok({ sort })).toBe(true);
    }
    expect(ok({ sort: 'POPULAR' })).toBe(false);
  });

  it('cursor: a non-empty string of sane length', () => {
    expect(ok({ cursor: '' })).toBe(false);
    expect(ok({ cursor: 'x'.repeat(2049) })).toBe(false);
  });
});

describe('dates and ranges (A7)', () => {
  it('IsoDate is YYYY-MM-DD and a real day', () => {
    expect(IsoDate.safeParse('2026-09-22').success).toBe(true);
    expect(IsoDate.safeParse('2028-02-29').success).toBe(true);
    expect(IsoDate.safeParse('2026-02-29').success).toBe(false);
    expect(IsoDate.safeParse('2026-13-01').success).toBe(false);
    expect(IsoDate.safeParse('2026-9-22').success).toBe(false);
    expect(IsoDate.safeParse('2026-09-22T00:00:00Z').success).toBe(false);
  });

  it('a range may be open on either end but never reversed', () => {
    expect(ok({ eventDate: { from: '2026-10-01' } })).toBe(true);
    expect(ok({ eventDate: { to: '2026-10-01' } })).toBe(true);
    expect(ok({ eventDate: { from: '2026-10-01', to: '2026-10-01' } })).toBe(true);
    expect(ok({ eventDate: { from: '2026-10-02', to: '2026-10-01' } })).toBe(false);
    expect(ok({ registration: { deadlineFrom: '2026-10-02', deadlineTo: '2026-10-01' } })).toBe(
      false,
    );
  });
});

describe('response shapes', () => {
  const item = {
    id: UUID,
    title: 'Smart India Hackathon',
    organizerName: null,
    eventType: 'HACKATHON',
    mode: 'OFFLINE',
    distanceKm: 120.5,
    registrationDeadlineAt: null,
    registrationDeadlinePrecision: 'UNKNOWN',
    startsAt: null,
    datePrecision: 'UNKNOWN',
    prize: { text: null, totalMinor: null, currency: null },
    teamMin: 2,
    teamMax: 4,
    sources: ['devfolio'],
    hasConflicts: false,
  };

  it('EventListItem carries the dense-card fields and nothing else', () => {
    expect(EventListItem.safeParse(item).success).toBe(true);
    expect(EventListItem.safeParse({ ...item, description: 'x' }).success).toBe(false);
    expect(EventListItem.safeParse({ ...item, distanceKm: -1 }).success).toBe(false);
  });

  it('SearchResponse: nextCursor and correction are optional', () => {
    const ranked = {
      ...item,
      score: 15,
      reasons: [{ code: 'NO_CONFLICTS', text: 'Sources agree on the details', weightApplied: 5 }],
    };
    expect(
      SearchResponse.safeParse({ items: [ranked], total: 1, totalIsApproximate: false }).success,
    ).toBe(true);
    const correction = {
      searchedTerm: 'hackthon',
      usedTerm: 'hackathon',
      message: 'Showing results for hackathon (searched hackthon)',
    };
    expect(SpellingCorrection.safeParse(correction).success).toBe(true);
    expect(
      SearchResponse.safeParse({
        items: [],
        total: 0,
        totalIsApproximate: false,
        correction,
        nextCursor: 'c',
      }).success,
    ).toBe(true);
  });
});

describe('aliases', () => {
  it('terms are folded and single-spaced', () => {
    expect(AliasTerm.parse('  Machine   Learning ')).toBe('machine learning');
  });

  it('an alias needs at least one expansion and is strict', () => {
    expect(SearchAliasInput.safeParse({ expansions: [] }).success).toBe(false);
    expect(SearchAliasInput.safeParse({ expansions: ['x'], extra: 1 }).success).toBe(false);
    expect(SearchAliasInput.parse({ expansions: ['GenAI'], replace: true })).toEqual({
      expansions: ['genai'],
      replace: true,
    });
  });
});
