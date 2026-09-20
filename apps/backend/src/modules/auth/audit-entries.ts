import type { AuditEntry } from '../../platform/audit.js';
import type { LoginContext } from './types.js';

/**
 * The audit rows the sign-in path writes (ruling R34, §15).
 *
 * Building them is pure, so it lives apart from the service that writes them:
 * what goes into a row is a decision about what an admin exporting this table
 * gets to see, and it should be readable without reading the login flow around
 * it. The one rule that matters is negative — no password, no token, ever, not
 * even a truncated one.
 */

/**
 * A refused sign-in. `extra` carries the failure counter and, when this attempt
 * crossed a threshold, how long the account is now locked for.
 */
export function loginFailureEntry(
  userId: string | null,
  email: string,
  reason: string,
  context: LoginContext,
  extra: Readonly<Record<string, unknown>> = {},
): AuditEntry {
  return {
    actorKind: 'USER',
    actorUserId: userId,
    action: 'auth.login.failed',
    entityKind: 'user',
    entityId: userId ?? email,
    summary: `Sign-in refused for ${email}: ${reason}`,
    diff: { reason, ...extra },
    requestId: context.requestId ?? null,
  };
}
