import { describe, expect, it } from 'vitest';

import { assignWarnings, type WarningInput } from './assign.js';

const NOW = Date.parse('2026-10-08T06:00:00.000Z');
const DAY = 86_400_000;
const base: WarningInput = {
  registrationDeadlineAt: NOW + 30 * DAY,
  cancellation: 'NONE',
  teamMin: null,
  teamMax: null,
  kind: 'TEAM',
  rosterSizes: [3],
};
const codes = (input: Partial<WarningInput>) =>
  assignWarnings({ ...base, ...input }, NOW).map((warning) => warning.code);

describe('the assign warnings (R98)', () => {
  it('says nothing when all is well, and nothing about what is unknown', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ registrationDeadlineAt: null })).toEqual([]);
  });

  it('warns of a closed or closing registration', () => {
    expect(codes({ registrationDeadlineAt: NOW - DAY })).toEqual(['REGISTRATION_CLOSED']);
    expect(codes({ registrationDeadlineAt: NOW + 3 * DAY })).toEqual(['REGISTRATION_CLOSING']);
    expect(codes({ registrationDeadlineAt: NOW + 4 * DAY })).toEqual([]);
    expect(
      assignWarnings({ ...base, registrationDeadlineAt: NOW + 2 * DAY }, NOW)[0]?.message,
    ).toBe('Registration closes in 2 days.');
  });

  it('warns of a cancelled or postponed event', () => {
    expect(codes({ cancellation: 'CANCELLED' })).toEqual(['EVENT_CANCELLED']);
    expect(codes({ cancellation: 'POSTPONED' })).toEqual(['EVENT_POSTPONED']);
  });

  it('warns when the roster is outside the team size', () => {
    expect(codes({ teamMin: 4 })).toEqual(['TEAM_TOO_SMALL']);
    expect(codes({ teamMax: 2 })).toEqual(['TEAM_TOO_LARGE']);
    expect(codes({ teamMin: 2, teamMax: 4 })).toEqual([]);
    expect(codes({ kind: 'INDIVIDUAL', rosterSizes: [1, 1], teamMin: 2 })).toEqual([
      'TEAM_TOO_SMALL',
    ]);
  });
});
