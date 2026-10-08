import { describe, expect, it } from 'vitest';

import { makeTeam } from '../../testing/teams-api.js';
import { emptyTeamForm, toCreateRequest, validateTeamForm, withLead } from './team-form.js';
import { alsoIn, coverageText, disabledReason, parseTargets } from './team-model.js';

describe('coverage in words', () => {
  it.each([
    [{ covered: 3, thin: 1, missing: 2 }, '3 covered · 1 thin · 2 missing'],
    [{ covered: 0, thin: 2, missing: 0 }, '2 thin'],
    [{ covered: 0, thin: 0, missing: 0 }, 'No skills yet'],
  ])('%o → %s', (counts, text) => {
    expect(coverageText(counts)).toBe(text);
  });
});

describe('why a control is off', () => {
  it('is undefined when allowed, and names who may when not', () => {
    const team = makeTeam(1);
    expect(disabledReason(team, 'edit')).toBeUndefined();
    const co = { ...team, can: { ...team.can, manageMentors: false } };
    expect(disabledReason(co, 'manageMentors')).toMatch(/primary mentor or an administrator/);
  });

  it('an archived team explains itself on everything but Unarchive', () => {
    const team = makeTeam(1, { status: 'ARCHIVED' });
    expect(disabledReason(team, 'edit')).toMatch(/archived/);
    expect(disabledReason(team, 'archive')).toBeUndefined();
  });
});

describe('small helpers', () => {
  it('"Also in" counts teams', () => {
    expect(alsoIn(0)).toBeUndefined();
    expect(alsoIn(1)).toBe('Also in 1 team');
    expect(alsoIn(2)).toBe('Also in 2 teams');
  });

  it('targets are split, trimmed and de-duplicated case-insensitively', () => {
    expect(parseTargets(' Python, sql;  Machine   learning, python ,')).toEqual([
      'Python',
      'sql',
      'Machine learning',
    ]);
  });
});

describe('the team form', () => {
  const member = (id: string, isLead = false) => ({
    studentId: id,
    fullName: id,
    universityId: id,
    roleLabel: '',
    isLead,
  });

  it('one lead at most: a second lead replaces the first, a second press clears it', () => {
    const once = withLead([member('a', true), member('b')], 'b');
    expect(once.map((m) => m.isLead)).toEqual([false, true]);
    expect(withLead(once, 'b').map((m) => m.isLead)).toEqual([false, false]);
  });

  it('asks for a name, and for a primary only when one is needed', () => {
    expect(validateTeamForm(emptyTeamForm(), false)).toEqual({
      name: 'Give the team a name of at least 2 characters.',
    });
    expect(validateTeamForm({ ...emptyTeamForm(), name: 'Ok' }, true).primary).toBeDefined();
  });

  it('sends only what was filled in', () => {
    expect(
      toCreateRequest({
        ...emptyTeamForm(),
        name: '  Alpha ',
        targets: 'Python, SQL',
        members: [{ ...member('s1', true), roleLabel: ' Backend ' }, member('s2')],
      }),
    ).toEqual({
      name: 'Alpha',
      targets: ['Python', 'SQL'],
      members: [{ studentId: 's1', roleLabel: 'Backend', isLead: true }, { studentId: 's2' }],
    });
  });
});
