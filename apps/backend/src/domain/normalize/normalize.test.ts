import type { EventCandidate } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../platform/time.js';
import {
  ALL_CASES,
  BASE_CONTEXT,
  BASE_INPUT,
  CASES_BY_FAMILY,
  CASE_NOW,
  valueAt,
  type NormalizeCase,
} from './cases/index.js';
import { normalizeCandidate, SUMMARY_MAX_LENGTH, type NormalizeContext } from './index.js';

/**
 * The table-driven normalization suite — the acceptance criterion for WP-08a
 * (§7.3).
 *
 * Every case runs against one fixed clock, so nothing here can drift with the
 * calendar. The cases themselves are pure data in `cases/`; this file is the
 * only thing that knows how to assert.
 */

const clock = fixedClock(CASE_NOW);

function run(testCase: NormalizeCase): EventCandidate {
  const context: NormalizeContext = { clock, ...BASE_CONTEXT, ...testCase.ctx };
  return normalizeCandidate({ ...BASE_INPUT, ...testCase.input }, context).candidate;
}

describe('the normalization case table', () => {
  it('holds at least a hundred cases, so the count cannot rot', () => {
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(100);
  });

  it('gives every case a distinct name', () => {
    const names = ALL_CASES.map((testCase) => testCase.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * §7.3 names ten cases that must exist. A count alone would not notice one of
   * them being renamed away, so each is looked up by the phrase that identifies
   * it.
   */
  it('contains every case §7.3 names', () => {
    const required = [
      'end before start',
      'a start year far in the future',
      'a date-only registration deadline',
      'an unparseable timezone',
      'two currencies',
      'solo or teams of 2',
      'title year that disagrees with the start year',
      'an e-mail inside a description',
      'a phone number with spaces and +91',
      'every optional field absent',
    ];
    for (const phrase of required) {
      const found = ALL_CASES.some((testCase) =>
        testCase.name.toLowerCase().includes(phrase.toLowerCase()),
      );
      expect(found, `no case named for "${phrase}"`).toBe(true);
    }
  });
});

for (const [family, cases] of Object.entries(CASES_BY_FAMILY)) {
  describe(`normalize — ${family}`, () => {
    for (const testCase of cases) {
      it(testCase.name, () => {
        const candidate = run(testCase);
        const { fields, lessThan, warnings, noWarnings, absent } = testCase.expect;

        for (const [path, value] of Object.entries(fields ?? {})) {
          expect(valueAt(candidate, path), path).toStrictEqual(value);
        }
        for (const [path, limit] of Object.entries(lessThan ?? {})) {
          expect(valueAt(candidate, path), path).toBeLessThan(limit);
        }

        const codes = candidate.warnings.map((warning) => warning.code);
        for (const code of warnings ?? []) {
          expect(codes, `expected the ${code} warning`).toContain(code);
        }
        for (const code of noWarnings ?? []) {
          expect(codes, `did not expect the ${code} warning`).not.toContain(code);
        }

        for (const field of absent ?? []) {
          expect(candidate[field], `${field} should be absent, not guessed`).toBeUndefined();
        }

        // Every warning is renderable: a code a professor can act on and a
        // message that says what was dropped.
        for (const warning of candidate.warnings) {
          expect(warning.message.length).toBeGreaterThan(0);
        }
      });
    }
  });
}

describe('invariants that hold for every case', () => {
  it('never produces a summary longer than the column allows', () => {
    for (const testCase of ALL_CASES) {
      const summary = run(testCase).summary;
      if (summary !== undefined) {
        expect(summary.length, testCase.name).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
      }
    }
  });

  it('never produces an end before a start', () => {
    for (const testCase of ALL_CASES) {
      const candidate = run(testCase);
      if (candidate.startsAt !== undefined && candidate.endsAt !== undefined) {
        expect(candidate.endsAt.at, testCase.name).toBeGreaterThanOrEqual(candidate.startsAt.at);
      }
    }
  });

  it('never stores raw HTML in the description', () => {
    for (const testCase of ALL_CASES) {
      const description = run(testCase).descriptionMd;
      if (description !== undefined) {
        expect(description, testCase.name).not.toMatch(/<\/?(?:script|iframe|style|p|div)\b/i);
      }
    }
  });

  it('never stores a known fee without an amount and a currency', () => {
    for (const testCase of ALL_CASES) {
      const fee = run(testCase).fee;
      if (fee?.known === true) {
        expect(fee.minor, testCase.name).toBeTypeOf('number');
        expect(fee.currency, testCase.name).toBeTypeOf('string');
      }
    }
  });

  it('cuts a long summary on a word boundary', () => {
    const long = `<p>${'word '.repeat(200).trim()}</p>`;
    const candidate = normalizeCandidate(
      { ...BASE_INPUT, description: long },
      { clock, ...BASE_CONTEXT },
    ).candidate;
    expect(candidate.summary).toBeDefined();
    expect(candidate.summary?.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
    expect(candidate.summary?.endsWith('…')).toBe(true);
    // No half-word before the ellipsis.
    expect(candidate.summary?.slice(0, -1).endsWith('word')).toBe(true);
  });

  it('is deterministic: the same input twice gives the same candidate', () => {
    for (const testCase of ALL_CASES) {
      expect(run(testCase), testCase.name).toStrictEqual(run(testCase));
    }
  });
});
