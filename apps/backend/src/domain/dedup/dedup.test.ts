import type { DedupConfig } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import {
  assess,
  comparableUrl,
  dateProximity,
  decide,
  isCandidate,
  locationModeAgreement,
  normalizeTitle,
  score,
  titleSimilarity,
  urlSpellings,
  type DedupSubject,
} from './index.js';

/** §7.5, R64 and R65, on the pure functions. */

const CONFIG: DedupConfig = {
  autoMergeThreshold: 0.9,
  candidateThreshold: 0.7,
  weights: { title: 0.45, organizer: 0.2, dateProximity: 0.2, locationMode: 0.15 },
};

const HOUR = 3_600_000;
const BASE = Date.parse('2026-10-10T04:30:00Z');

function subject(overrides: Partial<DedupSubject> = {}): DedupSubject {
  return {
    title: 'HackX 2026',
    organizerName: 'HackX Society',
    editionYear: 2026,
    startsAt: BASE,
    mode: 'ONLINE',
    ...overrides,
  };
}

describe('normalizeTitle', () => {
  it.each([
    ['HackX 2026', 'hackx'],
    ['The HackX Hackathon — Season 3 Edition', 'hackx 3'],
    ['HACKX 2025-26 v2', 'hackx'],
    ['Smart India Hackathon 2026', 'smart india'],
    ['Ünïcode Fest', 'unicode fest'],
  ])('%s → %s', (title, expected) => {
    expect(normalizeTitle(title)).toBe(expected);
  });

  it('scores the same event under different wordings as identical', () => {
    expect(titleSimilarity('HackX 2026', 'The HackX Hackathon')).toBe(1);
    expect(titleSimilarity('HackX', 'Something Else Entirely')).toBeLessThan(0.5);
    expect(titleSimilarity('2026', 'Hackathon')).toBe(0);
  });
});

describe('the features', () => {
  it('date proximity is 1 at the same start and 0 at ±3 days, deadlines at ±2 days', () => {
    expect(dateProximity({ startsAt: BASE }, { startsAt: BASE })).toBe(1);
    expect(dateProximity({ startsAt: BASE }, { startsAt: BASE + 36 * HOUR })).toBeCloseTo(0.5);
    expect(dateProximity({ startsAt: BASE }, { startsAt: BASE + 72 * HOUR })).toBe(0);
    expect(
      dateProximity({ registrationDeadlineAt: BASE }, { registrationDeadlineAt: BASE + 24 * HOUR }),
    ).toBeCloseTo(0.5);
    expect(dateProximity({}, { startsAt: BASE })).toBe(0);
  });

  it('location/mode puts mode first', () => {
    expect(locationModeAgreement({ mode: 'ONLINE' }, { mode: 'ONLINE' })).toBe(1);
    expect(
      locationModeAgreement(
        { mode: 'OFFLINE', city: 'Pune', countryCode: 'IN' },
        { mode: 'ONLINE', city: 'Pune', countryCode: 'IN' },
      ),
    ).toBe(0);
    expect(
      locationModeAgreement(
        { mode: 'OFFLINE', city: 'Pune', countryCode: 'IN' },
        { mode: 'OFFLINE', city: 'pune', countryCode: 'IN' },
      ),
    ).toBe(1);
    expect(
      locationModeAgreement(
        { mode: 'OFFLINE', countryCode: 'IN' },
        { mode: 'OFFLINE', countryCode: 'KR' },
      ),
    ).toBe(0.5);
  });

  it('compares URLs the way two sources would write them', () => {
    expect(comparableUrl('http://www.HackX.example.org/2026/?utm=1#top')).toBe(
      'https://hackx.example.org/2026?utm=1',
    );
    expect(comparableUrl('mailto:a@b.c')).toBeUndefined();
    expect(urlSpellings('https://hackx.example.org/')).toContain('http://www.hackx.example.org/');
  });
});

describe('score and decide (§7.5)', () => {
  it('a URL match scores 1.0 and says so in the breakdown', () => {
    const result = score(
      subject({ officialUrl: 'https://hackx.example.org/' }),
      subject({ title: 'Totally different', officialUrl: 'http://www.hackx.example.org' }),
      CONFIG.weights,
    );
    expect(result.total).toBe(1);
    expect(result.features.urlMatch).toBe(true);
    expect(result.features.title).toBeLessThan(0.5);
  });

  it('returns the full feature breakdown with every assessment', () => {
    const [assessment] = assess(subject(), [subject({ startsAt: BASE + HOUR })], CONFIG);
    expect(Object.keys(assessment!.score.features).sort()).toEqual([
      'dateProximity',
      'locationMode',
      'organizer',
      'title',
      'urlMatch',
    ]);
  });

  it('R64: different known years are NEW even with the same URL, and are not candidates to score', () => {
    const a = subject({ editionYear: 2025, officialUrl: 'https://hackx.example.org/' });
    const b = subject({ editionYear: 2026, officialUrl: 'https://hackx.example.org/' });
    const result = score(a, b, CONFIG.weights);
    expect(result.total).toBe(1);
    expect(decide(a, b, result, CONFIG)).toBe('NEW');
    expect(assess(a, [b], CONFIG)[0]?.decision).toBe('NEW');
  });

  it('a null year on one side leaves the score to decide', () => {
    const a = subject({ editionYear: null });
    expect(decide(a, subject(), score(a, subject(), CONFIG.weights), CONFIG)).toBe('AUTO_MERGE');
  });

  it('R65: raising autoMergeThreshold to 0.95 turns an auto-merge into a candidate', () => {
    // Identical but for a start 30 h apart: 0.45 + 0.20 + 0.20 × (1 − 30/72) + 0.15 ≈ 0.917.
    const a = subject();
    const b = subject({ startsAt: BASE + 30 * HOUR });
    const result = score(a, b, CONFIG.weights);
    expect(result.total).toBeGreaterThanOrEqual(0.9);
    expect(result.total).toBeLessThan(0.95);
    expect(decide(a, b, result, CONFIG)).toBe('AUTO_MERGE');
    expect(decide(a, b, result, { ...CONFIG, autoMergeThreshold: 0.95 })).toBe('CANDIDATE');
  });

  it('candidate generation needs the same year, overlapping dates and some title overlap', () => {
    expect(isCandidate(subject(), subject({ startsAt: BASE + 2 * 24 * HOUR }))).toBe(true);
    expect(isCandidate(subject(), subject({ startsAt: BASE + 5 * 24 * HOUR }))).toBe(false);
    expect(isCandidate(subject(), subject({ title: 'Quiz Night 2026' }))).toBe(false);
    expect(isCandidate(subject(), subject({ editionYear: 2027 }))).toBe(false);
  });
});
