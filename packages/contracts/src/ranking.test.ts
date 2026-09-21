import { describe, expect, it } from 'vitest';

import {
  CategoryRuleCreate,
  RankedEventListItem,
  RELEVANCE_REASON_CODES,
  SearchRequest,
  SearchResponse,
} from './index.js';

const UUID = '01920000-0000-7000-8000-000000000001';

const card = {
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
  watchlisted: false,
};

const reason = { code: 'WITHIN_RADIUS', text: '~121 km (straight line)', weightApplied: 10 };

describe('ranked results (D-18)', () => {
  it('a ranked card with one reason is valid', () => {
    expect(RankedEventListItem.safeParse({ ...card, score: 10, reasons: [reason] }).success).toBe(
      true,
    );
  });

  // The acceptance criterion as a schema rule: an empty reason list cannot be serialized.
  it('reasons: [] fails the schema', () => {
    const empty = { ...card, score: 10, reasons: [] };
    expect(RankedEventListItem.safeParse(empty).success).toBe(false);
    expect(
      SearchResponse.safeParse({ items: [empty], total: 1, totalIsApproximate: false }).success,
    ).toBe(false);
  });

  it('a reason code outside the closed list, or empty text, is refused', () => {
    const bad = (value: object) =>
      RankedEventListItem.safeParse({ ...card, score: 1, reasons: [{ ...reason, ...value }] })
        .success;
    expect(bad({ code: 'VIBES' })).toBe(false);
    expect(bad({ text: '' })).toBe(false);
    expect(bad({ weightApplied: -1 })).toBe(false);
    expect(RELEVANCE_REASON_CODES).toContain('SORT_KEY');
    expect(RELEVANCE_REASON_CODES).toHaveLength(11);
  });

  it('SearchRequest is an EventQuery plus `facets`, still strict', () => {
    expect(SearchRequest.safeParse({ facets: false }).success).toBe(true);
    expect(SearchRequest.safeParse({ text: 'ai', facets: true }).success).toBe(true);
    expect(SearchRequest.safeParse({ facet: false }).success).toBe(false);
  });
});

describe('category rules', () => {
  it('weight is 0–100 and the pattern is at most 200 characters', () => {
    const rule = { categoryId: UUID, kind: 'KEYWORD', pattern: 'ai', weight: 50 };
    expect(CategoryRuleCreate.parse(rule).fields).toBe('ALL');
    expect(CategoryRuleCreate.safeParse({ ...rule, weight: 101 }).success).toBe(false);
    expect(CategoryRuleCreate.safeParse({ ...rule, pattern: 'x'.repeat(201) }).success).toBe(false);
    expect(CategoryRuleCreate.safeParse({ ...rule, kind: 'AI' }).success).toBe(false);
  });
});
