import { SEARCH_SORTS } from '@compintel/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { RANKING_THRESHOLDS, RANKING_WEIGHTS } from '../settings.js';
import { compareRelevance, rank, scoreOf, type RankContext, type RankRow } from './rank.js';

const NOW = Date.parse('2026-09-22T06:30:00.000Z'); // noon IST
const DAY = 86_400_000;

const base: RankRow = {
  id: '0192-a',
  mode: 'OFFLINE',
  registrationOpensAt: null,
  registrationDeadlineAt: null,
  registrationDeadlinePrecision: 'UNKNOWN',
  startsAt: null,
  datePrecision: 'UNKNOWN',
  distanceKm: null,
  teamMin: null,
  teamMax: null,
  prizeTotalMinor: null,
  prizeCurrency: null,
  hasConflicts: true,
  firstSeenAt: NOW - 30 * DAY,
  textScore: null,
  trustedSource: undefined,
  interestCategories: [],
  interestTags: [],
};

const context: RankContext = {
  now: NOW,
  timeZone: 'Asia/Kolkata',
  weights: RANKING_WEIGHTS.default,
  thresholds: RANKING_THRESHOLDS.default,
  sort: 'RELEVANCE',
};

const codes = (row: Partial<RankRow>, ctx: Partial<RankContext> = {}) =>
  rank({ ...base, ...row }, { ...context, ...ctx }).reasons.map((reason) => reason.code);
const text = (row: Partial<RankRow>, ctx: Partial<RankContext> = {}) =>
  rank({ ...base, ...row }, { ...context, ...ctx }).reasons.map((reason) => reason.text);

describe('reasons are correct, not just present', () => {
  it('a deadline three days out is CLOSING_SOON with its date, not REGISTRATION_OPEN', () => {
    const deadline = Date.parse('2026-09-25T18:29:00.000Z'); // 25 Sep, 23:59 IST
    const ranked = rank(
      { ...base, registrationDeadlineAt: deadline, registrationDeadlinePrecision: 'DATETIME' },
      context,
    );
    expect(ranked.reasons).toContainEqual({
      code: 'CLOSING_SOON',
      text: 'Registration closes in 3 days (25 Sep)',
      weightApplied: 15,
    });
    expect(ranked.reasons.map((reason) => reason.code)).not.toContain('REGISTRATION_OPEN');
  });

  it('today and tomorrow are said as such', () => {
    expect(
      text({ registrationDeadlineAt: NOW + 3600_000, registrationDeadlinePrecision: 'DATETIME' }),
    ).toContain('Registration closes today');
    expect(
      text({ registrationDeadlineAt: NOW + DAY, registrationDeadlinePrecision: 'DATE' }),
    ).toContain('Registration closes tomorrow (23 Sep)');
  });

  it('a later deadline is REGISTRATION_OPEN "until"; another year carries the year', () => {
    expect(
      text({
        registrationDeadlineAt: Date.parse('2026-10-27T10:00:00Z'),
        registrationDeadlinePrecision: 'DATE',
      }),
    ).toContain('Registration open until 27 Oct');
    expect(
      text({
        registrationDeadlineAt: Date.parse('2027-01-05T10:00:00Z'),
        registrationDeadlinePrecision: 'DATE',
      }),
    ).toContain('Registration open until 5 Jan 2027');
  });

  it('closed or not-yet-open registration fires neither', () => {
    expect(codes({ registrationDeadlineAt: NOW - DAY })).not.toContain('REGISTRATION_OPEN');
    const notOpen = codes({
      registrationOpensAt: NOW + DAY,
      registrationDeadlineAt: NOW + 20 * DAY,
    });
    expect(notOpen).not.toContain('REGISTRATION_OPEN');
    expect(notOpen).not.toContain('CLOSING_SOON');
  });

  it('a 400 km event under a 500 km filter is WITHIN_RADIUS "~400 km (straight line)"', () => {
    const ranked = rank({ ...base, distanceKm: 400.2 }, { ...context, radiusKm: 500 });
    expect(ranked.reasons).toContainEqual({
      code: 'WITHIN_RADIUS',
      text: '~400 km (straight line)',
      weightApplied: 10,
    });
    expect(codes({ distanceKm: 600 }, { radiusKm: 500 })).not.toContain('WITHIN_RADIUS');
  });

  it('has_conflicts suppresses NO_CONFLICTS', () => {
    expect(codes({ hasConflicts: true })).not.toContain('NO_CONFLICTS');
    expect(codes({ hasConflicts: false })).toContain('NO_CONFLICTS');
  });

  it('interests, team size, trust and recency speak in full sentences', () => {
    const all = text(
      {
        interestCategories: ['AI/ML'],
        interestTags: ['Python', 'Rust'],
        teamMin: 2,
        teamMax: 4,
        trustedSource: 'Devfolio',
        firstSeenAt: NOW - 2 * DAY,
      },
      { teamSizeFits: 3 },
    );
    expect(all).toEqual(
      expect.arrayContaining([
        'AI/ML matches your interests',
        'Tagged Python, Rust, one of your interests',
        'Team size 2–4 fits',
        'Listed on Devfolio',
        'Added 2 days ago',
      ]),
    );
    expect(codes({ trustedSource: undefined })).not.toContain('TRUSTED_SOURCE');
    expect(codes({ teamMin: 5, teamMax: 6 }, { teamSizeFits: 3 })).not.toContain('TEAM_SIZE_FITS');
  });

  it('text is normalized against the best hit; a substring-only hit scores 0 but still says why', () => {
    const best = rank(
      { ...base, textScore: -8 },
      { ...context, text: 'hackathon', bestTextScore: -8 },
    );
    const half = rank(
      { ...base, textScore: -4 },
      { ...context, text: 'hackathon', bestTextScore: -8 },
    );
    const trigram = rank(
      { ...base, textScore: 0 },
      { ...context, text: 'ackath', bestTextScore: -8 },
    );
    expect(best.reasons[0]).toEqual({
      code: 'TEXT_MATCH',
      text: 'Matches “hackathon”',
      weightApplied: 40,
    });
    expect(half.reasons[0]?.weightApplied).toBe(20);
    expect(trigram.reasons[0]).toEqual({
      code: 'TEXT_MATCH',
      text: 'Matches “ackath”',
      weightApplied: 0,
    });
  });
});

describe('the sort key is always stated', () => {
  it.each([
    [
      'DEADLINE',
      {
        registrationDeadlineAt: Date.parse('2026-10-27T10:00:00Z'),
        registrationDeadlinePrecision: 'DATE',
      },
      'Registration closes 27 Oct',
    ],
    [
      'START',
      { startsAt: Date.parse('2026-10-03T04:00:00Z'), datePrecision: 'DATE' },
      'Starts 3 Oct',
    ],
    ['START', {}, 'Start date not announced'],
    ['DISTANCE', { distanceKm: 120 }, '~120 km (straight line)'],
    ['DISTANCE', { mode: 'ONLINE' }, 'Online'],
    ['PRIZE', { prizeTotalMinor: 5_000_000, prizeCurrency: 'INR' }, 'Prize ₹50,000'],
    ['PRIZE', {}, 'No prize amount stated'],
    ['NEWEST', { firstSeenAt: Date.parse('2026-03-12T10:00:00Z') }, 'First listed 12 Mar'],
  ] as const)('%s → %s', (sort, row, expected) => {
    const ranked = rank({ ...base, ...(row as Partial<RankRow>) }, { ...context, sort });
    expect(ranked.reasons[0]).toEqual({ code: 'SORT_KEY', text: expected, weightApplied: 0 });
  });

  it('RELEVANCE with nothing firing states the deadline its tie-break used', () => {
    expect(rank(base, context).reasons).toEqual([
      { code: 'SORT_KEY', text: 'Registration deadline not announced', weightApplied: 0 },
    ]);
  });

  it('a sort key that repeats a boost is not said twice', () => {
    const reasons = rank(
      { ...base, distanceKm: 80 },
      { ...context, sort: 'DISTANCE', radiusKm: 100 },
    ).reasons;
    expect(reasons.filter((reason) => reason.text === '~80 km (straight line)')).toHaveLength(1);
  });
});

describe('invariants', () => {
  const rowArb = fc.record({
    registrationDeadlineAt: fc.option(fc.integer({ min: NOW - 60 * DAY, max: NOW + 120 * DAY }), {
      nil: null,
    }),
    registrationOpensAt: fc.option(fc.integer({ min: NOW - 60 * DAY, max: NOW + 60 * DAY }), {
      nil: null,
    }),
    distanceKm: fc.option(fc.double({ min: 0, max: 3000, noNaN: true }), { nil: null }),
    hasConflicts: fc.boolean(),
    firstSeenAt: fc.integer({ min: NOW - 90 * DAY, max: NOW }),
    textScore: fc.option(fc.double({ min: -20, max: 0, noNaN: true }), { nil: null }),
    teamMin: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
    teamMax: fc.option(fc.integer({ min: 1, max: 8 }), { nil: null }),
  });

  it('every sort, every row: at least one reason, and the score is the sum of the points', () => {
    fc.assert(
      fc.property(
        rowArb,
        fc.constantFrom(...SEARCH_SORTS),
        fc.option(fc.integer({ min: 1, max: 6 })),
        (row, sort, fits) => {
          const ranked = rank(
            { ...base, ...row },
            {
              ...context,
              sort,
              text: 'x',
              bestTextScore: -20,
              radiusKm: 500,
              teamSizeFits: fits ?? undefined,
            },
          );
          expect(ranked.reasons.length).toBeGreaterThanOrEqual(1);
          // The cheap path RELEVANCE orders by must agree with the page's explained score.
          expect(
            scoreOf(
              { ...base, ...row },
              {
                ...context,
                sort,
                text: 'x',
                bestTextScore: -20,
                radiusKm: 500,
                teamSizeFits: fits ?? undefined,
              },
            ),
          ).toBe(ranked.score);
          const sum = ranked.reasons.reduce((total, reason) => total + reason.weightApplied, 0);
          expect(ranked.score).toBeCloseTo(sum, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('compareRelevance is a total order: score desc, deadline asc (unknown last), id asc', () => {
    const keys = [
      { score: 10, deadline: null, id: 'b' },
      { score: 10, deadline: 5, id: 'c' },
      { score: 20, deadline: null, id: 'a' },
      { score: 10, deadline: 5, id: 'a' },
    ];
    expect(
      [...keys]
        .sort(compareRelevance)
        .map((key) => `${String(key.score)}/${String(key.deadline)}/${key.id}`),
    ).toEqual(['20/null/a', '10/5/a', '10/5/c', '10/null/b']);
  });
});
