import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventUserState, watchlistItems } from '../../db/schema/index.js';
import { openSearchHarness, type SearchHarness } from '../../testing/search.js';

/**
 * Structured filters on a seeded database (§8.1, A6, A7, D-06, §7.4). Each
 * case names the rule it pins; the planner's own tests prove the plan, these
 * prove the SQL carries it out.
 */

let h: SearchHarness;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-22T06:30:00.000Z');
const TRICHY = { lat: 10.7905, lon: 78.7047 };

beforeEach(() => {
  h = openSearchHarness();
});

afterEach(() => {
  h.close();
});

const sorted = (titles: string[]): string[] => [...titles].sort();

describe('A6 — fee', () => {
  beforeEach(() => {
    h.add({ title: 'Free', feeKnown: true, feeMinor: 0, feeCurrency: 'INR' });
    h.add({ title: 'Cheap', feeKnown: true, feeMinor: 20_000, feeCurrency: 'INR' });
    h.add({ title: 'Dear', feeKnown: true, feeMinor: 90_000, feeCurrency: 'INR' });
    h.add({ title: 'Dollars', feeKnown: true, feeMinor: 1_000, feeCurrency: 'USD' });
    h.add({ title: 'Unknown fee' });
  });

  it('a fee filter excludes unknown fees', () => {
    expect(sorted(h.titles({ feeMax: { minor: 50_000, currency: 'INR' } }))).toEqual([
      'Cheap',
      'Free',
    ]);
  });

  it('includeUnknown.fee brings them back', () => {
    expect(
      sorted(
        h.titles({ feeMax: { minor: 50_000, currency: 'INR' }, includeUnknown: { fee: true } }),
      ),
    ).toEqual(['Cheap', 'Free', 'Unknown fee']);
  });

  it('freeOnly never matches an unknown fee, even with includeUnknown.fee', () => {
    expect(h.titles({ freeOnly: true })).toEqual(['Free']);
    expect(h.titles({ freeOnly: true, includeUnknown: { fee: true } })).toEqual(['Free']);
  });

  it('another currency is never converted into a match', () => {
    expect(h.titles({ feeMax: { minor: 5_000, currency: 'USD' } }).sort()).toEqual([
      'Dollars',
      'Free',
    ]);
  });
});

describe('A6 — team size', () => {
  beforeEach(() => {
    h.add({ title: '2 to 4', teamMin: 2, teamMax: 4 });
    h.add({ title: 'Solo', teamMin: 1, teamMax: 1 });
    h.add({ title: 'Up to 5', teamMax: 5 });
    h.add({ title: 'Unknown team' });
  });

  it('team_min ≤ n ≤ team_max, a missing bound being open', () => {
    expect(sorted(h.titles({ teamSizeFits: 3 }))).toEqual(['2 to 4', 'Up to 5']);
  });

  it('includeUnknown.teamSize admits the unknown one', () => {
    expect(sorted(h.titles({ teamSizeFits: 3, includeUnknown: { teamSize: true } }))).toEqual([
      '2 to 4',
      'Unknown team',
      'Up to 5',
    ]);
  });
});

describe('A6 + D-06 — location and distance', () => {
  beforeEach(() => {
    h.campus(TRICHY.lat, TRICHY.lon);
    h.add({ title: 'Near, offline', mode: 'OFFLINE', lat: 10.8, lon: 78.7, geoPrecision: 'CITY' });
    h.add({
      title: 'Chennai, hybrid',
      mode: 'HYBRID',
      lat: 13.0827,
      lon: 80.2707,
      geoPrecision: 'CITY',
    });
    h.add({
      title: 'Delhi, offline',
      mode: 'OFFLINE',
      lat: 28.61,
      lon: 77.21,
      geoPrecision: 'CITY',
    });
    h.add({ title: 'Online', mode: 'ONLINE' });
    h.add({ title: 'Nowhere known', mode: 'OFFLINE' });
    h.add({ title: 'Country only', mode: 'OFFLINE', lat: 22, lon: 79, geoPrecision: 'COUNTRY' });
  });

  it('maxDistanceKm keeps OFFLINE/HYBRID within the circle and excludes ONLINE', () => {
    // Trichy → Chennai is ~307 km in a straight line.
    expect(h.titles({ maxDistanceKm: 300 })).toEqual(['Near, offline']);
    expect(sorted(h.titles({ maxDistanceKm: 350 }))).toEqual(['Chennai, hybrid', 'Near, offline']);
  });

  it('includes ONLINE (with no distance) when modes names ONLINE', () => {
    const response = h.query({ maxDistanceKm: 350, modes: ['OFFLINE', 'HYBRID', 'ONLINE'] });
    expect(sorted(response.items.map((item) => item.title))).toEqual([
      'Chennai, hybrid',
      'Near, offline',
      'Online',
    ]);
    expect(response.items.find((item) => item.title === 'Online')?.distanceKm).toBeNull();
  });

  it('an unknown or coarse location is excluded unless includeUnknown.location', () => {
    expect(h.titles({ maxDistanceKm: 5000 })).not.toContain('Nowhere known');
    expect(sorted(h.titles({ maxDistanceKm: 350, includeUnknown: { location: true } }))).toEqual([
      'Chennai, hybrid',
      'Country only',
      'Near, offline',
      'Nowhere known',
    ]);
  });

  it('R81: a STATE-precision event is unknown location, even when its centroid is near', () => {
    // Tamil Nadu's centroid is ~35 km from Trichy — a figure that would look
    // exact on a card and is not.
    h.add({
      title: 'Somewhere in Tamil Nadu',
      mode: 'OFFLINE',
      lat: 11.13,
      lon: 78.66,
      geoPrecision: 'STATE',
    });
    expect(h.titles({ maxDistanceKm: 100 })).not.toContain('Somewhere in Tamil Nadu');
    const widened = h.query({ maxDistanceKm: 100, includeUnknown: { location: true } });
    const item = widened.items.find((entry) => entry.title === 'Somewhere in Tamil Nadu');
    expect(item).toBeDefined();
    // No distance on the card, and so no "~35 km" reason under RELEVANCE.
    expect(item?.distanceKm).toBeNull();
    const ranked = h.query({ sort: 'RELEVANCE', includeUnknown: { location: true } });
    const reasons = ranked.items.find((entry) => entry.title === 'Somewhere in Tamil Nadu');
    expect(reasons?.distanceKm).toBeNull();
    expect(JSON.stringify(reasons)).not.toContain('WITHIN_RADIUS');
  });

  it('distance is the one haversine, straight line, sortable', () => {
    const response = h.query({ sort: 'DISTANCE', modes: ['OFFLINE', 'HYBRID'] });
    expect(response.items.map((item) => item.title).slice(0, 3)).toEqual([
      'Near, offline',
      'Chennai, hybrid',
      'Delhi, offline',
    ]);
    const chennai = response.items.find((item) => item.title === 'Chennai, hybrid');
    expect(chennai?.distanceKm).toBeGreaterThan(300);
    expect(chennai?.distanceKm).toBeLessThan(315);
  });
});

describe('A6 — registration deadline', () => {
  beforeEach(() => {
    h.add({ title: 'Closes in 3 days', registrationDeadlineAt: NOW + 3 * DAY });
    h.add({ title: 'Closes in 20 days', registrationDeadlineAt: NOW + 20 * DAY });
    h.add({ title: 'Closed', registrationDeadlineAt: NOW - DAY });
    h.add({
      title: 'Opens later',
      registrationOpensAt: NOW + 5 * DAY,
      registrationDeadlineAt: NOW + 30 * DAY,
    });
    h.add({ title: 'No deadline' });
  });

  it('a deadline range excludes unknown deadlines unless includeUnknown.deadline', () => {
    const range = { deadlineFrom: '2026-09-22', deadlineTo: '2026-10-31' };
    expect(sorted(h.titles({ registration: range }))).toEqual([
      'Closes in 20 days',
      'Closes in 3 days',
      'Opens later',
    ]);
    expect(h.titles({ registration: range, includeUnknown: { deadline: true } })).toContain(
      'No deadline',
    );
  });

  it('derived states follow §6.4 and the fake clock', () => {
    expect(h.titles({ registration: { states: ['CLOSING_SOON'] } })).toEqual(['Closes in 3 days']);
    expect(h.titles({ registration: { states: ['OPEN'] } })).toEqual(['Closes in 20 days']);
    expect(h.titles({ registration: { states: ['NOT_OPEN'] } })).toEqual(['Opens later']);
    expect(h.titles({ registration: { states: ['CLOSED'] } })).toEqual(['Closed']);
    h.clock.set('2026-10-10T00:00:00.000Z');
    expect(h.titles({ registration: { states: ['CLOSING_SOON'] } })).toEqual(['Closes in 20 days']);
  });
});

describe('A7 — event dates in IST', () => {
  it('an event at 18:31 UTC belongs to the next IST day', () => {
    h.add({ title: 'Just after midnight IST', startsAt: Date.parse('2026-10-01T18:31:00.000Z') });
    h.add({ title: 'Late on the 1st IST', startsAt: Date.parse('2026-10-01T18:29:00.000Z') });
    expect(h.titles({ eventDate: { from: '2026-10-01', to: '2026-10-01' } })).toEqual([
      'Late on the 1st IST',
    ]);
    expect(h.titles({ eventDate: { from: '2026-10-02', to: '2026-10-02' } })).toEqual([
      'Just after midnight IST',
    ]);
  });

  it('a multi-day event overlapping the range matches; an unknown start does not', () => {
    h.add({
      title: 'Spans New Year',
      startsAt: Date.parse('2026-12-30T04:00:00.000Z'),
      endsAt: Date.parse('2027-01-02T04:00:00.000Z'),
    });
    h.add({ title: 'Undated' });
    expect(h.titles({ eventDate: { from: '2027-01-01', to: '2027-01-01' } })).toEqual([
      'Spans New Year',
    ]);
  });
});

describe('defaults: recurring rounds and ended events', () => {
  beforeEach(() => {
    h.add({ title: 'Round 901', eventType: 'CODING_CONTEST', isRecurringRound: true });
    h.add({ title: 'Ended', startsAt: NOW - 10 * DAY, endsAt: NOW - 9 * DAY });
    h.add({ title: 'Upcoming', startsAt: NOW + 10 * DAY });
  });

  it('both are excluded unless asked for (D-08)', () => {
    expect(h.titles({})).toEqual(['Upcoming']);
    expect(sorted(h.titles({ includeRecurring: true, includeEnded: true }))).toEqual([
      'Ended',
      'Round 901',
      'Upcoming',
    ]);
  });

  it('recurringOnly keeps the rounds alone — of any type — and facets count only them', () => {
    h.add({ title: 'Weekly Ideathon', eventType: 'IDEATHON', isRecurringRound: true });
    expect(sorted(h.titles({ recurringOnly: true }))).toEqual(['Round 901', 'Weekly Ideathon']);
    // It implies includeRecurring, whatever that flag says.
    expect(h.titles({ recurringOnly: true, includeRecurring: false })).toHaveLength(2);
    const response = h.query({ recurringOnly: true, facets: true });
    const counted = response.facets?.eventType.reduce((sum, entry) => sum + entry.count, 0);
    expect(counted).toBe(2);
    expect(response.facets?.eventType.find((entry) => entry.value === 'HACKATHON')?.count).toBe(0);
  });
});

describe('per-user state', () => {
  it('excludeHidden drops only the caller’s hidden events', () => {
    const me = h.user();
    const other = h.user();
    const hidden = h.add({ title: 'Hidden by me' });
    h.add({ title: 'Visible' });
    h.database.db.drizzle
      .insert(eventUserState)
      .values({ userId: me.id, eventId: hidden, isHidden: true })
      .run();
    expect(h.titles({ excludeHidden: true }, me)).toEqual(['Visible']);
    expect(sorted(h.titles({ excludeHidden: true }, other))).toEqual(['Hidden by me', 'Visible']);
    expect(sorted(h.titles({}, me))).toEqual(['Hidden by me', 'Visible']);
  });

  it('watchlistedOnly keeps only the caller’s saved events', () => {
    const me = h.user();
    const saved = h.add({ title: 'Saved' });
    h.add({ title: 'Not saved' });
    h.database.db.drizzle
      .insert(watchlistItems)
      .values({ userId: me.id, eventId: saved, addedAt: NOW })
      .run();
    expect(h.titles({ watchlistedOnly: true }, me)).toEqual(['Saved']);
    expect(h.titles({ watchlistedOnly: true })).toEqual([]);
  });
});

describe('§7.4 / R57 — hidden and merged events never appear', () => {
  it('POLICY_HIDDEN, ADMIN_HIDDEN and MERGED are absent with or without text', () => {
    const survivor = h.add({ title: 'Survivor Hackathon' });
    h.add({
      title: 'Policy Hackathon',
      visibility: 'POLICY_HIDDEN',
      policyReason: 'EVENT_TYPE_NOT_ALLOWED',
    });
    h.add({ title: 'Admin Hackathon', visibility: 'ADMIN_HIDDEN' });
    h.add({ title: 'Merged Hackathon', visibility: 'MERGED', mergedIntoEventId: survivor });
    for (const query of [
      {},
      { text: 'hackathon' },
      { text: 'ackath' },
      { includeEnded: true, includeRecurring: true },
    ]) {
      const response = h.query(query);
      expect(response.items.map((item) => item.title)).toEqual(['Survivor Hackathon']);
      expect(response.total).toBe(1);
    }
  });
});

describe('list items', () => {
  it('carry the card fields, source keys and the total', () => {
    const id = h.add({
      title: 'Carded',
      prizeText: '₹1,00,000',
      prizeTotalMinor: 10_000_000,
      prizeCurrency: 'INR',
      teamMin: 2,
      teamMax: 4,
      hasConflicts: true,
    });
    h.addSource(id, 'devfolio');
    h.addSource(id, 'ctftime');
    const [item] = h.query({}).items;
    expect(item).toMatchObject({
      id,
      title: 'Carded',
      prize: { text: '₹1,00,000', totalMinor: 10_000_000, currency: 'INR' },
      teamMin: 2,
      teamMax: 4,
      sources: ['ctftime', 'devfolio'],
      hasConflicts: true,
      distanceKm: null,
    });
  });

  // WP-15b stores both; `categories.test.ts` and `facets.test.ts` filter by them.
});
