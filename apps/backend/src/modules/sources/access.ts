import type { SetSourceSessionRequest } from '@compintel/contracts';

import type { SourceRow } from '../../db/schema/index.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { Principal } from '../auth/types.js';
import type { SourcesRepository } from './repository.js';

/**
 * The three audited acts that give a source its way in: storing an API key
 * (WP-11), storing the professor's session and signing it out (R74/D-34).
 *
 * Each is audited **without the value** — who did what to which source, and
 * when — because an administrator can export the audit log, and a key or a
 * cookie in it would be a credential in a file somebody e-mails.
 *
 * Each also answers R80's standing sentence. A refused key or an expired
 * session leaves a notice on Source status until a person acts; these acts are
 * that person acting, so the notice goes in the same audited transaction.
 */

export interface AccessActDependencies {
  readonly audit: AuditLog;
  readonly sources: SourcesRepository;
}

export interface AccessActContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

/** Stores an API key; a refused one's state and sentence are forgotten (R80). */
export function recordCredentialStored(
  deps: AccessActDependencies,
  context: AccessActContext,
  source: SourceRow,
  store: () => boolean,
): void {
  withAudit(
    deps.audit,
    {
      actorKind: 'USER',
      actorUserId: context.actor.id,
      action: 'source.credential.set',
      entityKind: 'source',
      entityId: source.id,
      summary: `Stored the ${source.name} API credential`,
      diff: {},
      requestId: context.requestId ?? null,
    },
    () => {
      deps.sources.setCredentialState(source.id, null);
      deps.sources.setNotice(source.id, null);
      return store();
    },
  );
}

/** Stores the professor's session; an expiry notice is cleared (R80). */
export function recordSessionStored(
  deps: AccessActDependencies,
  context: AccessActContext,
  source: SourceRow,
  capturedVia: SetSourceSessionRequest['capturedVia'],
  store: () => boolean,
): void {
  withAudit(
    deps.audit,
    {
      actorKind: 'USER',
      actorUserId: context.actor.id,
      action: 'source.session.set',
      entityKind: 'source',
      entityId: source.id,
      summary: `Stored a ${source.name} session for ${context.actor.displayName}`,
      diff: { capturedVia },
      requestId: context.requestId ?? null,
    },
    () => {
      deps.sources.setNotice(source.id, null);
      return store();
    },
  );
}

/** Signs the app out of a source; the next run reads its public pages. */
export function recordSessionCleared(
  deps: AccessActDependencies,
  context: AccessActContext,
  source: SourceRow,
  clear: () => boolean,
): void {
  withAudit(
    deps.audit,
    {
      actorKind: 'USER',
      actorUserId: context.actor.id,
      action: 'source.session.cleared',
      entityKind: 'source',
      entityId: source.id,
      summary: `Removed the stored ${source.name} session`,
      diff: {},
      requestId: context.requestId ?? null,
    },
    () => {
      deps.sources.setNotice(source.id, null);
      return clear();
    },
  );
}
