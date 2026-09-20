import { decide, effectiveRule, type Action, type OwnershipFacts } from '@compintel/contracts';

import { forbidden } from '../../platform/errors.js';
import type { Principal } from './service.js';

/**
 * The one place an authorization question is answered (§10.1, ruling R32).
 *
 * It holds no rules of its own: the matrix is `packages/contracts/permissions.ts`
 * and this is the door it is consulted through. Application services call
 * `assertCan`; routes never decide, because a route that decides is a rule that
 * cannot be reached from a service invoked by a job, an import or the AI.
 */

/** Just enough of a user to be judged; a session's `user` satisfies it. */
export type PolicySubject = Pick<Principal, 'id' | 'roles'>;

/** Whether this subject may take this action on a resource with these facts. */
export function can(subject: PolicySubject, action: Action, facts?: OwnershipFacts): boolean {
  return decide(subject.roles, action, facts);
}

/**
 * The same question, as a guard. The message names the action and nothing else:
 * whether a *specific* row exists is not something a 403 should reveal.
 */
export function assertCan(subject: PolicySubject, action: Action, facts?: OwnershipFacts): void {
  if (!can(subject, action, facts)) {
    throw forbidden(
      `Your account is not allowed to ${action.replace(/[._]/g, ' ')}.`,
      'An administrator can change what your account may do.',
    );
  }
}

/**
 * Whether an action is worth offering at all, ignoring any particular resource.
 * The UI uses this to hide a control outright; it is never a substitute for
 * `assertCan` on the way in (§10.1).
 */
export function couldEver(subject: PolicySubject, action: Action): boolean {
  return effectiveRule(subject.roles, action) !== 'NEVER';
}
