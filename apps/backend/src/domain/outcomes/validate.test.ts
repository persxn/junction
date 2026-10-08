import { ENGAGEMENT_STATUSES, type OutcomeInput } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { canRecord, recordBlockedReason, validateOutcome } from './validate.js';

/** R104's rules (WP-21 step 3). */

const ok = (input: Partial<OutcomeInput>) => validateOutcome({ result: 'WINNER', ...input });

describe('when an outcome may be recorded', () => {
  it('only from PARTICIPATING or COMPLETED, with a reason otherwise', () => {
    expect(ENGAGEMENT_STATUSES.filter(canRecord)).toEqual(['PARTICIPATING', 'COMPLETED']);
    expect(recordBlockedReason('APPLIED')).toBe(
      'Record the result once the competition is underway.',
    );
    expect(recordBlockedReason('WITHDRAWN')).toMatch(/closed without taking part/);
    expect(recordBlockedReason('COMPLETED')).toBeUndefined();
  });
});

describe('the fields (R104, R63)', () => {
  it('keeps an amount in its own currency and blanks empty text', () => {
    expect(
      ok({
        rank: 2,
        prizeMinor: 2_500_000,
        prizeCurrency: 'INR',
        prizeText: '  ',
        notes: ' Good ',
      }),
    ).toEqual({
      ok: true,
      value: {
        result: 'WINNER',
        rank: 2,
        prizeText: null,
        prizeMinor: 2_500_000,
        prizeCurrency: 'INR',
        resultUrl: null,
        notes: 'Good',
        feedback: null,
      },
    });
  });

  it.each([
    [{ prizeMinor: 100 }, /needs its currency/],
    [{ prizeCurrency: 'USD' }, /needs its currency/],
    [{ prizeMinor: 100, prizeCurrency: 'usd' }, /three-letter code in capitals/],
    [{ prizeMinor: 100, prizeCurrency: 'US' }, /three-letter code/],
    [{ prizeMinor: -5, prizeCurrency: 'USD' }, /cannot be negative/],
    [{ rank: 0 }, /from 1 up/],
    [{ rank: 1.5 }, /from 1 up/],
    [{ resultUrl: 'javascript:alert(1)' }, /http or https/],
    [{ resultUrl: 'file:///C:/x' }, /http or https/],
  ])('refuses %j', (input, problem) => {
    const result = ok(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(problem);
  });
});
