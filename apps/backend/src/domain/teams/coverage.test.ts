import { describe, expect, it } from 'vitest';

import { coverage, stateOf, teamNameKey, type CoverageMember } from './coverage.js';

const member = (skills: [string, number | null][], active = true): CoverageMember => ({
  active,
  skills: skills.map(([name, proficiency]) => ({ name, proficiency })),
});

const stateFor = (members: CoverageMember[], skill: string, targets: string[] = [skill]) =>
  coverage(members, targets).chips.find((chip) => chip.name === skill)?.state;

describe('R94 coverage states', () => {
  it.each([
    ['two beginners', [member([['Python', 1]]), member([['Python', 1]])], 'COVERED'],
    ['one intermediate', [member([['Python', 2]])], 'COVERED'],
    ['one advanced', [member([['Python', 3]])], 'COVERED'],
    ['one beginner', [member([['Python', 1]])], 'THIN'],
    ['one unrated', [member([['Python', null]])], 'THIN'],
    ['none', [member([['SQL', 3]])], 'MISSING'],
    ['an inactive member is ignored', [member([['Python', 3]], false)], 'MISSING'],
    [
      'an inactive second holder does not make it covered',
      [member([['Python', 1]]), member([['Python', 1]], false)],
      'THIN',
    ],
  ] as const)('%s', (_name, members, expected) => {
    expect(stateFor([...members], 'Python')).toBe(expected);
  });

  it('stateOf is the rule on its own', () => {
    expect(stateOf(0, null)).toBe('MISSING');
    expect(stateOf(1, null)).toBe('THIN');
    expect(stateOf(1, 2)).toBe('COVERED');
    expect(stateOf(2, null)).toBe('COVERED');
  });
});

describe('the chips', () => {
  it('with targets, lists the targets — gaps first — and counts them', () => {
    const result = coverage(
      [
        member([
          ['Python', 3],
          ['UI design', 1],
        ]),
        member([['python', 1]]),
      ],
      ['UI design', 'Python', 'Embedded C'],
    );
    expect(result.chips.map((chip) => [chip.name, chip.state, chip.holders])).toEqual([
      ['Embedded C', 'MISSING', 0],
      ['UI design', 'THIN', 1],
      ['Python', 'COVERED', 2],
    ]);
    expect(result.counts).toEqual({ covered: 1, thin: 1, missing: 1 });
  });

  it('without targets, lists the members’ skills and never Missing', () => {
    const result = coverage(
      [
        member([
          ['Python', 1],
          ['SQL', 3],
        ]),
        member([], false),
      ],
      [],
    );
    expect(result.chips.map((chip) => chip.state)).toEqual(['THIN', 'COVERED']);
    expect(result.counts.missing).toBe(0);
    expect(result.chips.every((chip) => !chip.isTarget)).toBe(true);
  });

  it('counts a member once even if a skill is listed twice', () => {
    expect(
      coverage(
        [
          member([
            ['Python', 1],
            ['PYTHON', 1],
          ]),
        ],
        ['Python'],
      ).chips[0]?.holders,
    ).toBe(1);
  });

  it('an empty team with targets has every target missing', () => {
    expect(coverage([], ['Python', 'SQL']).counts).toEqual({ covered: 0, thin: 0, missing: 2 });
  });
});

describe('teamNameKey (R95)', () => {
  it('compares trimmed, single-spaced and case-insensitive', () => {
    expect(teamNameKey('  Byte  Busters ')).toBe(teamNameKey('byte busters'));
  });
});
