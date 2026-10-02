import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  decide,
  effectiveRule,
  OWNERSHIP_RULES,
  permissionsFor,
  ROLE_ACTIONS,
  ROLE_KEYS,
  ruleFor,
  ruleSatisfied,
  canDeactivateStudent,
  isSelf,
  type Action,
  type OwnershipFacts,
  type OwnershipRule,
  type RoleKey,
} from './permissions.js';

/**
 * The §19 acceptance criterion: "every action × role × ownership".
 *
 * The suite is generated from `ACTIONS` and `ROLE_KEYS`, so adding a capability
 * without deciding what each role may do with it fails here rather than shipping
 * as a silent allow or a silent deny.
 */

/** Every combination of facts a rule could be judged against, including none. */
const FACT_SETS: readonly (OwnershipFacts | undefined)[] = [
  undefined,
  {},
  { isOwner: true },
  { isTeamMentor: true },
  { isTeamPrimaryMentor: true },
  { isStudentMentor: true },
  { isOwner: true, isTeamMentor: true, isTeamPrimaryMentor: true, isStudentMentor: true },
];

/** What each rule is meant to answer for a given set of facts. */
function expectedFor(rule: OwnershipRule, facts: OwnershipFacts | undefined): boolean {
  switch (rule) {
    case 'ALWAYS':
      return true;
    case 'NEVER':
      return false;
    case 'OWN':
      return facts?.isOwner === true;
    case 'TEAM_MENTOR':
      return facts?.isTeamMentor === true || facts?.isTeamPrimaryMentor === true;
    case 'TEAM_PRIMARY_MENTOR':
      return facts?.isTeamPrimaryMentor === true;
    case 'STUDENT_MENTOR':
      return facts?.isStudentMentor === true;
  }
}

describe('the matrix is complete (ruling R32)', () => {
  it('names both roles', () => {
    expect(Object.keys(ROLE_ACTIONS).sort()).toStrictEqual([...ROLE_KEYS].sort());
  });

  it.each(ROLE_KEYS)('%s decides every action', (role) => {
    const decided = Object.keys(ROLE_ACTIONS[role]).sort();
    expect(decided).toStrictEqual([...ACTIONS].sort());
  });

  it.each(ROLE_KEYS)('%s uses only known ownership rules', (role) => {
    for (const action of ACTIONS) {
      expect(OWNERSHIP_RULES).toContain(ruleFor(role, action));
    }
  });

  it('has no duplicate action names', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
  });
});

describe('every action × role × ownership (the §19 criterion)', () => {
  const combinations: [RoleKey, Action, number][] = [];
  for (const role of ROLE_KEYS) {
    for (const action of ACTIONS) {
      for (let index = 0; index < FACT_SETS.length; index += 1) {
        combinations.push([role, action, index]);
      }
    }
  }

  it(`covers ${String(combinations.length)} combinations`, () => {
    expect(combinations).toHaveLength(ROLE_KEYS.length * ACTIONS.length * FACT_SETS.length);
  });

  it.each(combinations)('%s / %s / facts #%i', (role, action, factIndex) => {
    const facts = FACT_SETS[factIndex];
    const rule = ruleFor(role, action);
    expect(decide([role], action, facts)).toBe(expectedFor(rule, facts));
  });
});

describe('the §10.2 rows that are not a plain yes or no', () => {
  it('lets a professor edit only a team they mentor', () => {
    expect(decide(['PROFESSOR'], 'team.edit', { isTeamMentor: true })).toBe(true);
    expect(decide(['PROFESSOR'], 'team.edit', { isTeamPrimaryMentor: true })).toBe(true);
    expect(decide(['PROFESSOR'], 'team.edit', {})).toBe(false);
  });

  it('reserves archiving and mentor changes for the primary mentor', () => {
    for (const action of ['team.archive', 'team.manage_mentors'] as const) {
      expect(decide(['PROFESSOR'], action, { isTeamPrimaryMentor: true })).toBe(true);
      // A co-mentor is a mentor but not the primary one.
      expect(decide(['PROFESSOR'], action, { isTeamMentor: true })).toBe(false);
    }
  });

  it('lets a professor deactivate only a student they mentor', () => {
    expect(decide(['PROFESSOR'], 'student.deactivate', { isStudentMentor: true })).toBe(true);
    expect(decide(['PROFESSOR'], 'student.deactivate', { isTeamMentor: true })).toBe(false);
  });

  it('lets a professor manage only his own mentorships (R91), an admin any mentorship', () => {
    const me = { id: 'u-1' };
    expect(decide(['PROFESSOR'], 'mentorship.manage', { isOwner: isSelf(me, 'u-1') })).toBe(true);
    expect(decide(['PROFESSOR'], 'mentorship.manage', { isOwner: isSelf(me, 'u-2') })).toBe(false);
    expect(decide(['ADMINISTRATOR'], 'mentorship.manage', { isOwner: false })).toBe(true);
  });

  it('decides deactivation from either mentor list (§10.2)', () => {
    const me = { id: 'u-1' };
    const facts = (mentorUserIds: string[], teamMentorUserIds: string[]) => ({
      isStudentMentor: canDeactivateStudent(me, { mentorUserIds, teamMentorUserIds }),
    });
    expect(decide(['PROFESSOR'], 'student.deactivate', facts(['u-1'], []))).toBe(true);
    expect(decide(['PROFESSOR'], 'student.deactivate', facts([], ['u-1']))).toBe(true);
    expect(decide(['PROFESSOR'], 'student.deactivate', facts(['u-2'], ['u-3']))).toBe(false);
    expect(decide(['ADMINISTRATOR'], 'student.deactivate', facts([], []))).toBe(true);
  });

  it('keeps the admin-only rows admin-only', () => {
    const adminOnly: readonly Action[] = [
      'student.erase',
      'team.transfer_ownership',
      'event.correct',
      'event.mark_cancelled',
      'event.merge_duplicates',
      'duplicate.review',
      'user.manage',
      'category.manage',
      'source.manage',
      'campus.manage',
      'settings.manage',
      'backup.restore',
      'export.all',
      'audit.view_all',
      'system.health.view',
      'workflow_template.manage_all',
    ];
    for (const action of adminOnly) {
      expect(ruleFor('PROFESSOR', action)).toBe('NEVER');
      expect(decide(['ADMINISTRATOR'], action, {})).toBe(true);
    }
  });

  it('keeps saved searches and hidden events personal, even for an admin', () => {
    for (const action of ['saved_search.manage', 'event.save', 'event.hide'] as const) {
      expect(ruleFor('ADMINISTRATOR', action)).toBe('OWN');
      expect(decide(['ADMINISTRATOR'], action, { isOwner: false })).toBe(false);
      expect(decide(['ADMINISTRATOR'], action, { isOwner: true })).toBe(true);
    }
  });

  it('lets both roles run a backup but only an admin restore one', () => {
    expect(decide(['PROFESSOR'], 'backup.run')).toBe(true);
    expect(decide(['PROFESSOR'], 'backup.restore')).toBe(false);
    expect(decide(['ADMINISTRATOR'], 'backup.restore')).toBe(true);
  });
});

describe('a user holding both roles', () => {
  const both: readonly RoleKey[] = ['PROFESSOR', 'ADMINISTRATOR'];

  it('gets the union of the two, whichever order they are in', () => {
    expect(effectiveRule(both, 'user.manage')).toBe('ALWAYS');
    expect(effectiveRule(['ADMINISTRATOR', 'PROFESSOR'], 'user.manage')).toBe('ALWAYS');
    // The admin's unrestricted rule wins over the professor's narrower one.
    expect(effectiveRule(both, 'team.archive')).toBe('ALWAYS');
    expect(decide(both, 'team.archive', {})).toBe(true);
  });

  it('is still bound by OWN where both roles say OWN', () => {
    expect(effectiveRule(both, 'saved_search.manage')).toBe('OWN');
    expect(decide(both, 'saved_search.manage', {})).toBe(false);
  });
});

describe('no roles at all', () => {
  it.each(ACTIONS)('denies %s', (action) => {
    expect(effectiveRule([], action)).toBe('NEVER');
    expect(decide([], action, { isOwner: true, isTeamPrimaryMentor: true })).toBe(false);
  });
});

describe('a missing resource is a denial, never an allow', () => {
  it.each(['OWN', 'TEAM_MENTOR', 'TEAM_PRIMARY_MENTOR', 'STUDENT_MENTOR'] as const)(
    '%s refuses when nothing is known about the resource',
    (rule) => {
      expect(ruleSatisfied(rule, undefined)).toBe(false);
      expect(ruleSatisfied(rule, {})).toBe(false);
    },
  );
});

describe('permissionsFor (what /me/permissions returns)', () => {
  it('lists what a professor may do and leaves out what they may not', () => {
    const entries = permissionsFor(['PROFESSOR']);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('team.create');
    expect(actions).toContain('team.edit');
    expect(actions).not.toContain('user.manage');
    expect(entries.find((entry) => entry.action === 'team.edit')?.rule).toBe('TEAM_MENTOR');
  });

  it('gives an admin every action', () => {
    expect(permissionsFor(['ADMINISTRATOR'])).toHaveLength(ACTIONS.length);
  });

  it('gives someone with no role nothing', () => {
    expect(permissionsFor([])).toStrictEqual([]);
  });

  it('never returns a NEVER', () => {
    for (const roles of [['PROFESSOR'], ['ADMINISTRATOR'], ROLE_KEYS] as const) {
      for (const entry of permissionsFor(roles)) {
        expect(entry.rule).not.toBe('NEVER');
      }
    }
  });
});
