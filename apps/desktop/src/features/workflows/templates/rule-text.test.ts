import { describe, expect, it } from 'vitest';

import { ruleText } from './rule-text.js';

describe('a due rule in words (R100)', () => {
  it('says the offset and the anchor', () => {
    expect(ruleText({ anchor: 'REGISTRATION_DEADLINE', offsetDays: -2 })).toBe(
      '2 days before the registration deadline',
    );
    expect(ruleText({ anchor: 'EVENT_END', offsetDays: 1 })).toBe('1 day after the event end');
    expect(ruleText({ anchor: 'SUBMISSION_DEADLINE', offsetDays: 0 })).toBe(
      'On the submission deadline',
    );
    expect(ruleText(null)).toBe('No date rule — set dates by hand');
  });

  it('names an event_deadlines kind', () => {
    expect(ruleText({ anchor: 'DEADLINE', kind: 'PPT', offsetDays: -1 })).toMatch(
      /^1 day before the .+ date$/,
    );
  });
});
