import { ACTIONS, ROLE_KEYS, ruleFor, type Action, type RoleKey } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../platform/errors.js';
import { assertCan, can, couldEver, type PolicySubject } from './policy.js';

/**
 * The backend half of §10.1: the policy module is the door, the contracts matrix
 * is the rule. These tests check the *door* — that `can` agrees with the matrix
 * for every action and role, and that `assertCan` turns a no into a 403 that
 * gives nothing away. The matrix itself is exhausted in
 * `packages/contracts/src/permissions.test.ts`.
 */

const subject = (...roles: RoleKey[]): PolicySubject => ({ id: 'user-1', roles });

describe('can() follows the contracts matrix exactly', () => {
  const cases: [RoleKey, Action][] = [];
  for (const role of ROLE_KEYS) {
    for (const action of ACTIONS) {
      cases.push([role, action]);
    }
  }

  it.each(cases)('%s / %s with full ownership', (role, action) => {
    const allowed = ruleFor(role, action) !== 'NEVER';
    expect(
      can(subject(role), action, {
        isOwner: true,
        isTeamMentor: true,
        isTeamPrimaryMentor: true,
        isStudentMentor: true,
        isCompetitionMentor: true,
        isCompetitionPrimaryMentor: true,
      }),
    ).toBe(allowed);
  });

  it.each(cases)('%s / %s with no resource', (role, action) => {
    expect(can(subject(role), action)).toBe(ruleFor(role, action) === 'ALWAYS');
  });
});

describe('assertCan', () => {
  it('passes silently when allowed', () => {
    expect(() => {
      assertCan(subject('ADMINISTRATOR'), 'user.manage');
    }).not.toThrow();
  });

  it('throws a 403 FORBIDDEN when not', () => {
    try {
      assertCan(subject('PROFESSOR'), 'user.manage');
      throw new Error('expected assertCan to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(403);
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('names the action but says nothing about the resource', () => {
    try {
      assertCan(subject('PROFESSOR'), 'team.archive', { isTeamMentor: true });
      throw new Error('expected assertCan to refuse');
    } catch (error) {
      const message = (error as AppError).detail ?? '';
      expect(message).toContain('team archive');
      // Whether a particular row exists is not something a 403 reveals.
      expect(message).not.toMatch(/team-\d|id|exists/i);
    }
  });

  it('refuses someone with no roles at all', () => {
    expect(() => {
      assertCan(subject(), 'event.view');
    }).toThrow(AppError);
  });
});

describe('couldEver (what the UI may show)', () => {
  it('is true for anything the role can ever do, resource or not', () => {
    expect(couldEver(subject('PROFESSOR'), 'team.archive')).toBe(true);
    // …even though it needs the primary-mentor fact to actually go through.
    expect(can(subject('PROFESSOR'), 'team.archive')).toBe(false);
  });

  it('is false for what the role can never do', () => {
    expect(couldEver(subject('PROFESSOR'), 'user.manage')).toBe(false);
    expect(couldEver(subject('ADMINISTRATOR'), 'user.manage')).toBe(true);
  });

  it('is the union for someone holding both roles', () => {
    expect(couldEver(subject('PROFESSOR', 'ADMINISTRATOR'), 'audit.view_all')).toBe(true);
  });
});
