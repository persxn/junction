import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { diffMatches, newMatchNotification, resultHash, savedSearchRoute } from './matches.js';

const search = { id: '01931f2a-0000-7000-8000-000000000001', name: 'AI hackathons near campus' };
const ev = (n: number) => ({ id: `e${String(n)}`, title: `Event ${String(n)}` });

describe('diffMatches (R112)', () => {
  it('returns ids never matched, in the current order, once', () => {
    expect(diffMatches(['a', 'b'], ['c', 'a', 'd', 'c'])).toStrictEqual(['c', 'd']);
  });

  it('treats an id that left and came back as old', () => {
    // The remembered set still holds b although the last run did not return it.
    expect(diffMatches(new Set(['a', 'b']), ['a', 'b'])).toStrictEqual([]);
  });

  it('is empty against the set it was given (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (ids) => {
        expect(diffMatches(ids, ids)).toStrictEqual([]);
      }),
    );
  });
});

describe('resultHash', () => {
  it('ignores order and duplicates', () => {
    expect(resultHash(['b', 'a', 'a'])).toBe(resultHash(['a', 'b']));
  });

  it('differs for a different set, and is hex SHA-256', () => {
    expect(resultHash(['a'])).not.toBe(resultHash(['a', 'b']));
    expect(resultHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('newMatchNotification', () => {
  it('names the count and the search, lists three titles and "and N more"', () => {
    const n = newMatchNotification(search, [ev(1), ev(2), ev(3), ev(4), ev(5)]);
    expect(n.title).toBe('5 new events match “AI hackathons near campus”');
    expect(n.body).toBe('Event 1 · Event 2 · Event 3 and 2 more');
    expect(n.route).toBe(savedSearchRoute(search.id));
    expect(n.route).toMatch(/^\/(?!\/)[A-Za-z0-9/_-]*$/);
  });

  it('says "1 new event matches" for one', () => {
    const n = newMatchNotification(search, [ev(1)]);
    expect(n.title).toBe('1 new event matches “AI hackathons near campus”');
    expect(n.body).toBe('Event 1');
  });

  it('keys on the search and the hash of the new ids', () => {
    const a = newMatchNotification(search, [ev(1), ev(2)]);
    const b = newMatchNotification(search, [ev(2), ev(1)]);
    const c = newMatchNotification(search, [ev(3)]);
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
    expect(a.dedupeKey.startsWith(`NEW_MATCH:saved_search:${search.id}:`)).toBe(true);
  });

  it('refuses an empty list', () => {
    expect(() => newMatchNotification(search, [])).toThrow();
  });
});
