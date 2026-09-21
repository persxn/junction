import { EventQuery, type EventQueryInput } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { expectGolden } from '../../../testing/golden.js';
import { fixedClock } from '../../../platform/time.js';
import { CLOSING_SOON_MS, planQuery, QueryPlanError, type PlanContext } from './normalize.js';

/**
 * The query planner is pure, so every interpretation §8.1, A6 and A7 make is
 * tested here without a database. The goldens are the review surface: a change
 * in what a query *means* is a diff in `test/fixtures/search/plans/`.
 */

const clock = fixedClock('2026-09-22T06:30:00.000Z');
const CAMPUS = { lat: 10.7594, lon: 78.8149 }; // Tiruchirappalli
const context: PlanContext = {
  nowMs: clock.now().getTime(),
  timeZone: 'Asia/Kolkata',
  campus: CAMPUS,
};

const plan = (input: EventQueryInput, ctx: PlanContext = context) =>
  planQuery(EventQuery.parse(input), ctx);

describe('A7 — dates are Asia/Kolkata days, inclusive, as UTC ms', () => {
  it('from is 00:00:00.000 IST and to is 23:59:59.999 IST', () => {
    const result = plan({ eventDate: { from: '2026-10-01', to: '2026-10-01' } });
    expect(new Date(result.eventDate?.fromMs ?? 0).toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(new Date(result.eventDate?.toMs ?? 0).toISOString()).toBe('2026-10-01T18:29:59.999Z');
  });

  it('crosses a (DST-free) year boundary without losing or gaining an hour', () => {
    const result = plan({ eventDate: { from: '2026-12-31', to: '2027-01-01' } });
    expect(new Date(result.eventDate?.fromMs ?? 0).toISOString()).toBe('2026-12-30T18:30:00.000Z');
    expect(new Date(result.eventDate?.toMs ?? 0).toISOString()).toBe('2027-01-01T18:29:59.999Z');
    expect((result.eventDate?.toMs ?? 0) - (result.eventDate?.fromMs ?? 0) + 1).toBe(
      2 * 24 * 60 * 60 * 1000,
    );
  });

  it('18:31 UTC is already the next IST day', () => {
    const instant = Date.parse('2026-10-01T18:31:00.000Z'); // 02 Oct 00:01 IST
    const first = plan({ eventDate: { to: '2026-10-01' } }).eventDate?.toMs ?? 0;
    const second = plan({ eventDate: { from: '2026-10-02' } }).eventDate?.fromMs ?? 0;
    expect(instant).toBeGreaterThan(first);
    expect(instant).toBeGreaterThanOrEqual(second);
  });

  it('registration deadlines use the same rule', () => {
    const result = plan({ registration: { deadlineFrom: '2026-09-25', deadlineTo: '2026-09-25' } });
    expect(new Date(result.registration?.fromMs ?? 0).toISOString()).toBe(
      '2026-09-24T18:30:00.000Z',
    );
    expect(new Date(result.registration?.toMs ?? 0).toISOString()).toBe('2026-09-25T18:29:59.999Z');
  });

  it('"now" is the injected clock, never the wall clock', () => {
    expect(plan({}).now).toBe(Date.parse('2026-09-22T06:30:00.000Z'));
    expect(plan({ registration: { states: ['OPEN'] } }).registration?.closingSoonUntil).toBe(
      Date.parse('2026-09-22T06:30:00.000Z') + CLOSING_SOON_MS,
    );
  });
});

describe('A6 — unknown values, per field', () => {
  it('fee: excluded unless includeUnknown.fee', () => {
    expect(plan({ feeMax: { minor: 100, currency: 'INR' } }).fee?.includeUnknown).toBe(false);
    expect(
      plan({ feeMax: { minor: 100, currency: 'INR' }, includeUnknown: { fee: true } }).fee
        ?.includeUnknown,
    ).toBe(true);
  });

  it('freeOnly never matches an unknown fee, whatever the flag says', () => {
    expect(plan({ freeOnly: true, includeUnknown: { fee: true } }).fee).toEqual({
      freeOnly: true,
      includeUnknown: false,
    });
  });

  it('an inactive filter ignores its includeUnknown flag entirely', () => {
    const result = plan({
      includeUnknown: { fee: true, teamSize: true, location: true, deadline: true },
    });
    expect(result.fee).toBeUndefined();
    expect(result.teamSize).toBeUndefined();
    expect(result.distance).toBeUndefined();
    expect(result.registration).toBeUndefined();
  });

  it('teamSize, location and deadline carry their own flags', () => {
    const result = plan({
      teamSizeFits: 3,
      maxDistanceKm: 100,
      registration: { deadlineTo: '2026-10-01' },
      includeUnknown: { teamSize: true, location: false, deadline: true },
    });
    expect(result.teamSize).toEqual({ fits: 3, includeUnknown: true });
    expect(result.distance?.includeUnknown).toBe(false);
    expect(result.registration?.includeUnknown).toBe(true);
  });

  it('distance admits ONLINE only when modes names it', () => {
    expect(plan({ maxDistanceKm: 300 }).distance?.includeOnline).toBe(false);
    expect(plan({ maxDistanceKm: 300, modes: ['OFFLINE'] }).distance?.includeOnline).toBe(false);
    expect(plan({ maxDistanceKm: 300, modes: ['OFFLINE', 'ONLINE'] }).distance?.includeOnline).toBe(
      true,
    );
  });
});

describe('sort and campus', () => {
  it('RELEVANCE orders by the §8.4 score, with or without text (WP-15b)', () => {
    expect(plan({ text: 'hackathon' }).sort).toEqual({
      requested: 'RELEVANCE',
      basis: 'SCORE',
      direction: 'DESC',
    });
    expect(plan({}).sort.basis).toBe('SCORE');
    expect(plan({ text: '   ' }).text).toBeUndefined();
  });

  it('PRIZE and NEWEST run descending', () => {
    expect(plan({ sort: 'PRIZE' }).sort.direction).toBe('DESC');
    expect(plan({ sort: 'NEWEST' }).sort.direction).toBe('DESC');
  });

  it('a distance filter or sort with no campus is refused, not guessed', () => {
    const noCampus: PlanContext = { nowMs: context.nowMs, timeZone: 'Asia/Kolkata' };
    expect(() => plan({ maxDistanceKm: 50 }, noCampus)).toThrow(QueryPlanError);
    expect(() => plan({ sort: 'DISTANCE' }, noCampus)).toThrow(QueryPlanError);
    expect(plan({}, noCampus).campus).toBeUndefined();
  });

  it('duplicate list values collapse and empty text yields no text plan', () => {
    expect(plan({ eventTypes: ['CTF', 'CTF', 'HACKATHON'] }).eventTypes).toEqual([
      'CTF',
      'HACKATHON',
    ]);
  });
});

describe('QueryPlan goldens', () => {
  const cases: Record<string, EventQueryInput> = {
    empty: {},
    'text-and-filters': {
      text: 'ML hackathon',
      eventTypes: ['HACKATHON'],
      modes: ['OFFLINE', 'HYBRID'],
      teamSizeFits: 3,
      feeMax: { minor: 50_000, currency: 'INR' },
      includeUnknown: { fee: true },
      sort: 'RELEVANCE',
    },
    'distance-with-online': {
      maxDistanceKm: 300,
      modes: ['OFFLINE', 'ONLINE'],
      includeUnknown: { location: true },
      sort: 'DISTANCE',
      limit: 50,
    },
    'dates-and-registration': {
      eventDate: { from: '2026-12-31', to: '2027-01-01' },
      registration: { states: ['OPEN', 'CLOSING_SOON'], deadlineTo: '2026-10-15' },
      includeRecurring: true,
      includeEnded: true,
      excludeHidden: true,
      watchlistedOnly: true,
    },
    'injection-text': { text: 'NEAR(hack* OR "x"' },
  };
  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      expectGolden(`search/plans/${name}`, plan(input));
    });
  }
});
