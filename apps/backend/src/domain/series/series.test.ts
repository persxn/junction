import { describe, expect, it } from 'vitest';

import { detectSeries, inferCadence, seriesKeyOf, type SeriesSubject } from './index.js';

/** §7.3 "Recurring rounds" and yearly editions, on the pure detector (WP-11). */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-22T14:35:00Z');

function contest(title: string, resource?: string, startsAt?: number): SeriesSubject {
  return { title, eventType: 'CODING_CONTEST', resource, startsAt };
}

describe('title patterns (rule b)', () => {
  it.each([
    ['Codeforces Round 975 (Div. 2)', 'codeforces round div', 'Codeforces Round (Div. 2)', '975'],
    [
      'Educational Codeforces Round 175',
      'educational codeforces round',
      'Educational Codeforces Round',
      '175',
    ],
    ['Weekly Contest 412', 'weekly contest', 'Weekly Contest', '412'],
    ['Biweekly Contest 141', 'biweekly contest', 'Biweekly Contest', '141'],
    ['AtCoder Beginner Contest 380', 'atcoder beginner contest', 'AtCoder Beginner Contest', '380'],
    ['Starters 123', 'starters', 'Starters', '123'],
  ])('%s → key "%s"', (title, key, name, label) => {
    const result = detectSeries(contest(title));
    expect(result).toMatchObject({ key, name, roundLabel: label, isRecurringRound: true });
  });

  it('the seriesKey is lower-case with no digits', () => {
    expect(seriesKeyOf('Codeforces Round (Div. 2)')).toBe('codeforces round div');
  });
});

describe('platforms (rule a)', () => {
  it('a named one-off on a rated platform is still a round', () => {
    expect(detectSeries(contest('Good Bye 2026', 'codeforces.com'))).toMatchObject({
      isRecurringRound: true,
      key: 'good bye',
    });
  });

  it('a generic "Round N" counts only on a round platform', () => {
    expect(detectSeries(contest('Qualification Round 2', 'example.org')).isRecurringRound).toBe(
      false,
    );
    expect(detectSeries(contest('Qualification Round 2', 'codechef.com')).isRecurringRound).toBe(
      true,
    );
  });

  it('a hackathon, ideathon or CTF is never a round, whatever lists it (rule d)', () => {
    for (const eventType of ['HACKATHON', 'IDEATHON', 'CTF'] as const) {
      expect(
        detectSeries({ title: 'Codeforces Round 999', eventType, resource: 'codeforces.com' })
          .isRecurringRound,
      ).toBe(false);
    }
  });
});

describe('cadence (rule c)', () => {
  it('≈ 7 / 14 / 30 days → WEEKLY / BIWEEKLY / MONTHLY; else IRREGULAR', () => {
    expect(inferCadence([T0, T0 + 7 * DAY, T0 + 14 * DAY])).toBe('WEEKLY');
    expect(inferCadence([T0, T0 + 14 * DAY, T0 + 28 * DAY])).toBe('BIWEEKLY');
    expect(inferCadence([T0, T0 + 30 * DAY, T0 + 61 * DAY])).toBe('MONTHLY');
    expect(inferCadence([T0, T0 + 3 * DAY, T0 + 20 * DAY])).toBe('IRREGULAR');
    expect(inferCadence([T0, T0 + 7 * DAY])).toBe('IRREGULAR');
  });

  it('uses only siblings of the same family', () => {
    const weekly = [0, 14, 28].map((days) =>
      contest(`Weekly Contest ${String(412 + days / 14)}`, 'leetcode.com', T0 + days * DAY),
    );
    const noise = contest('Starters 150', 'codechef.com', T0 + DAY);
    expect(detectSeries(weekly[0]!, [...weekly, noise])).toMatchObject({
      key: 'weekly contest',
      recurrence: 'BIWEEKLY',
    });
    expect(detectSeries(noise, [...weekly, noise]).recurrence).toBe('IRREGULAR');
  });
});

describe('yearly editions (rule e) and one-offs (rule d)', () => {
  it('"HackX 2026" is YEARLY and not a round', () => {
    expect(detectSeries({ title: 'HackX 2026', eventType: 'HACKATHON' })).toEqual({
      key: 'hackx',
      name: 'HackX',
      recurrence: 'YEARLY',
      isRecurringRound: false,
      confidence: 0.8,
    });
  });

  it('a one-off with no year and no pattern belongs to no series', () => {
    expect(
      detectSeries(contest('ICPC Asia West Continent Regional Contest', 'icpc.global')),
    ).toEqual({
      isRecurringRound: false,
      recurrence: 'NONE',
      confidence: 1,
    });
  });
});
