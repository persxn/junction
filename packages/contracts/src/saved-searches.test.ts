import { describe, expect, it } from 'vitest';

import {
  MyInterestsUpdate,
  SavedSearch,
  SavedSearchCreate,
  SavedSearchDeleteQuery,
  SavedSearchPatch,
} from './saved-searches.js';

const ID = '01931f2a-0000-7000-8000-000000000001';
const AT = '2026-10-09T10:00:00.000Z';

describe('SavedSearchCreate', () => {
  it('defaults notifyOnNew to true (R112: alerts on by default)', () => {
    const parsed = SavedSearchCreate.parse({ name: ' AI near campus ', query: { text: 'ai' } });
    expect(parsed.notifyOnNew).toBe(true);
    expect(parsed.name).toBe('AI near campus');
  });

  it('refuses a query key EventQuery does not know', () => {
    expect(SavedSearchCreate.safeParse({ name: 'x', query: { nearMe: true } }).success).toBe(false);
  });

  it('refuses an empty or over-long name', () => {
    expect(SavedSearchCreate.safeParse({ name: '  ', query: {} }).success).toBe(false);
    expect(SavedSearchCreate.safeParse({ name: 'x'.repeat(81), query: {} }).success).toBe(false);
  });
});

describe('SavedSearch', () => {
  const base = {
    id: ID,
    name: 'AI hackathons',
    query: { limit: 25 },
    invalidQuery: false,
    notifyOnNew: true,
    lastEvaluatedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
  };

  it('accepts a stored search and one whose query no longer parses', () => {
    expect(SavedSearch.safeParse(base).success).toBe(true);
    expect(SavedSearch.safeParse({ ...base, query: null, invalidQuery: true }).success).toBe(true);
  });

  it('needs a version for optimistic concurrency', () => {
    expect(SavedSearchPatch.safeParse({ name: 'x' }).success).toBe(false);
    expect(SavedSearchPatch.safeParse({ version: 2, notifyOnNew: false }).success).toBe(true);
    expect(SavedSearchDeleteQuery.parse({ version: '3' }).version).toBe(3);
  });
});

describe('MyInterestsUpdate', () => {
  it('takes the whole set plus typed-in names', () => {
    const parsed = MyInterestsUpdate.parse({
      categoryIds: [ID],
      tagIds: [],
      newTagNames: [' Rust '],
    });
    expect(parsed.newTagNames).toStrictEqual(['Rust']);
  });

  it('refuses ids that are not UUIDv7', () => {
    expect(MyInterestsUpdate.safeParse({ categoryIds: ['ai-ml'], tagIds: [] }).success).toBe(false);
  });
});
