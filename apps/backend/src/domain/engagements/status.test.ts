import { ENGAGEMENT_STATUSES, type EngagementStatus } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import {
  allowedFrom,
  canTransition,
  closesRoster,
  isTerminal,
  OPEN_STATUSES,
  transitionRefusal,
} from './status.js';

/** R97, written out a second time by hand, so a typo in the table fails here. */
const EXPECTED: Record<EngagementStatus, EngagementStatus[]> = {
  CONSIDERING: ['ASSIGNED', 'WITHDRAWN'],
  ASSIGNED: ['APPLIED', 'CONSIDERING', 'WITHDRAWN'],
  APPLIED: ['PARTICIPATING', 'NOT_SELECTED', 'WITHDRAWN'],
  PARTICIPATING: ['COMPLETED', 'WITHDRAWN'],
  COMPLETED: [],
  WITHDRAWN: [],
  NOT_SELECTED: [],
};

describe('the status machine (R97)', () => {
  const pairs = ENGAGEMENT_STATUSES.flatMap((from) =>
    ENGAGEMENT_STATUSES.map((to) => [from, to] as const),
  );

  it('has 49 (from, to) pairs and allows exactly ten', () => {
    expect(pairs).toHaveLength(49);
    expect(pairs.filter(([from, to]) => canTransition(from, to))).toHaveLength(10);
  });

  it.each(pairs)('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(EXPECTED[from].includes(to));
  });

  it('never allows staying put', () => {
    for (const status of ENGAGEMENT_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it('knows the terminal states and the ones that close the roster', () => {
    expect(ENGAGEMENT_STATUSES.filter(isTerminal)).toEqual([
      'COMPLETED',
      'WITHDRAWN',
      'NOT_SELECTED',
    ]);
    expect(ENGAGEMENT_STATUSES.filter(closesRoster)).toEqual(['WITHDRAWN', 'NOT_SELECTED']);
    // COMPLETED keeps its students: it is final but still "taken on".
    expect(OPEN_STATUSES).toContain('COMPLETED');
    expect(allowedFrom('APPLIED')).toEqual(EXPECTED.APPLIED);
  });

  it('refuses in words', () => {
    expect(transitionRefusal('CONSIDERING', 'APPLIED')).toBe(
      "Can't move from Considering to Applied. From Considering: Assigned or Withdrawn.",
    );
    expect(transitionRefusal('APPLIED', 'ASSIGNED')).toBe(
      "Can't move from Applied to Assigned. From Applied: Participating, Not selected or Withdrawn.",
    );
    expect(transitionRefusal('COMPLETED', 'APPLIED')).toBe(
      "Can't move from Completed to Applied. Completed is final.",
    );
  });
});
