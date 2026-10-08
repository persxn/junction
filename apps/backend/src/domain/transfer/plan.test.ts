import { describe, expect, it } from 'vitest';

import { isEmptyPlan, planTransfer, type CompetitionInput, type TeamInput } from './plan.js';

/** R105, pure (WP-21 step 3): what moves, what stays, and the collision cases. */

const ADA = { userId: 'u-ada', displayName: 'Ada Lovelace' };
const GRACE = { userId: 'u-grace', displayName: 'Grace Hopper' };
const NOW = 1_790_000_000_000;

const team = (id: string, patch: Partial<TeamInput> = {}): TeamInput => ({
  id,
  name: `Team ${id}`,
  status: 'ACTIVE',
  version: 3,
  mentors: [{ id: `${id}-ada`, userId: ADA.userId, role: 'PRIMARY' }],
  ...patch,
});
const competition = (id: string, patch: Partial<CompetitionInput> = {}): CompetitionInput => ({
  id,
  name: `Comp ${id}`,
  status: 'ASSIGNED',
  version: 5,
  mentors: [{ id: `${id}-ada`, userId: ADA.userId, role: 'PRIMARY' }],
  ...patch,
});
const plan = (input: Partial<Parameters<typeof planTransfer>[0]>) =>
  planTransfer({
    from: ADA,
    to: GRACE,
    teams: [],
    competitions: [],
    mentorships: [],
    toMentors: new Set(),
    now: NOW,
    ...input,
  });

describe('a plain move', () => {
  it('closes from’s row and opens to’s with the same role at one instant', () => {
    const result = plan({ teams: [team('t1')], competitions: [competition('c1')] });
    expect(result.closes).toEqual([
      { table: 'team_mentors', rowId: 't1-ada', entityId: 't1' },
      { table: 'engagement_mentors', rowId: 'c1-ada', entityId: 'c1' },
    ]);
    expect(result.opens).toEqual([
      { table: 'team_mentors', entityId: 't1', userId: GRACE.userId, role: 'PRIMARY' },
      { table: 'engagement_mentors', entityId: 'c1', userId: GRACE.userId, role: 'PRIMARY' },
    ]);
    expect(result.at).toBe(NOW);
    expect(result.teams[0]?.sentence).toBe(
      'Ada Lovelace (primary mentor) → Grace Hopper (primary mentor)',
    );
    expect(result.touchedTeams).toEqual(['t1']);
    expect(result.touchedCompetitions).toEqual(['c1']);
  });

  it('a co-mentor row moves as a co-mentor row', () => {
    const result = plan({
      teams: [
        team('t1', {
          mentors: [
            { id: 'p', userId: 'u-x', role: 'PRIMARY' },
            { id: 'c', userId: ADA.userId, role: 'CO_MENTOR' },
          ],
        }),
      ],
    });
    expect(result.opens[0]?.role).toBe('CO_MENTOR');
    expect(result.closes.map((c) => c.rowId)).toEqual(['c']);
  });
});

describe('collisions (R105)', () => {
  it('from PRIMARY, to already CO_MENTOR: to’s co-mentor row closes and a PRIMARY opens', () => {
    const result = plan({
      teams: [
        team('t1', {
          mentors: [
            { id: 'ada', userId: ADA.userId, role: 'PRIMARY' },
            { id: 'grace', userId: GRACE.userId, role: 'CO_MENTOR' },
          ],
        }),
      ],
    });
    expect(result.closes.map((c) => c.rowId)).toEqual(['ada', 'grace']);
    expect(result.opens).toEqual([
      { table: 'team_mentors', entityId: 't1', userId: GRACE.userId, role: 'PRIMARY' },
    ]);
    expect(result.teams[0]?.sentence).toBe(
      'Ada Lovelace (primary mentor) → Grace Hopper (primary mentor, was co-mentor)',
    );
  });

  it('from CO_MENTOR, to already PRIMARY: only from’s row closes', () => {
    const result = plan({
      competitions: [
        competition('c1', {
          mentors: [
            { id: 'grace', userId: GRACE.userId, role: 'PRIMARY' },
            { id: 'ada', userId: ADA.userId, role: 'CO_MENTOR' },
          ],
        }),
      ],
    });
    expect(result.closes.map((c) => c.rowId)).toEqual(['ada']);
    expect(result.opens).toEqual([]);
    expect(result.competitions[0]?.sentence).toBe(
      'Ada Lovelace (co-mentor) steps away; Grace Hopper stays primary mentor',
    );
  });

  it('a mentorship to already holds only closes from’s', () => {
    const result = plan({
      mentorships: [
        { id: 'm1', studentId: 's1', studentName: 'Asha', mentorUserId: ADA.userId },
        { id: 'm2', studentId: 's2', studentName: 'Ravi', mentorUserId: ADA.userId },
      ],
      toMentors: new Set(['s2']),
    });
    expect(result.closes.map((c) => c.rowId)).toEqual(['m1', 'm2']);
    expect(result.opens).toEqual([
      { table: 'mentorships', entityId: 's1', userId: GRACE.userId, role: null },
    ]);
  });
});

describe('what stays', () => {
  it('archived teams and closed competitions stay as history and are never touched', () => {
    const result = plan({
      teams: [team('old', { status: 'ARCHIVED' })],
      competitions: [
        competition('done', { status: 'COMPLETED' }),
        competition('gone', { status: 'WITHDRAWN' }),
        competition('no', { status: 'NOT_SELECTED' }),
        competition('live', { status: 'PARTICIPATING' }),
      ],
    });
    expect(result.staysWith.map((item) => item.entityId).sort()).toEqual([
      'done',
      'gone',
      'no',
      'old',
    ]);
    expect(result.staysWith[0]?.sentence).toBe('Stays with Ada Lovelace — history');
    expect(result.closes.map((c) => c.entityId)).toEqual(['live']);
  });

  it('a parent without from is not in the plan; nothing to move is an empty plan', () => {
    const result = plan({
      teams: [team('t', { mentors: [{ id: 'x', userId: 'u-x', role: 'PRIMARY' }] })],
    });
    expect(isEmptyPlan(result)).toBe(true);
    expect(result.staysWith).toEqual([]);
  });
});

describe('the preview token’s parts', () => {
  it('change when a parent’s version or the set of rows changes', () => {
    const before = plan({ teams: [team('t1')], competitions: [competition('c1')] }).tokenParts;
    expect(before).toEqual(['competition:c1-ada:5', 'team:t1-ada:3']);
    const bumped = plan({ teams: [team('t1', { version: 4 })], competitions: [competition('c1')] });
    expect(bumped.tokenParts).not.toEqual(before);
    const more = plan({ teams: [team('t1'), team('t2')], competitions: [competition('c1')] });
    expect(more.tokenParts).not.toEqual(before);
  });
});
