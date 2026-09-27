import type { SourceConnectPrompt } from '@compintel/contracts';

import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { SettingsStore } from '../../platform/settings.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import type { SourcesRepository } from './repository.js';
import { sessionConfigOf } from './session.js';
import { SOURCE_CONNECT_PROMPT_SEEN_AT } from './settings.js';

/**
 * The one-time "Connect your sources" step (R74's product flow, R75's limits).
 *
 * R74 says each professor signs in to every approved source with their own
 * account, and that it happens in first-run onboarding. This is the small piece
 * of state that makes "once" true: which sources can hold a session at all, and
 * whether this installation has been through the step. Everything the step
 * actually does — opening the window, storing the cookie — is already
 * `SourcesService`, and none of it is repeated here.
 *
 * Reading is open to anyone signed in, because the screen has to decide whether
 * to appear before it knows what the account may do; finishing it is
 * `source.manage`, like every other write about a source (§10.2). A professor who
 * cannot manage sources is never shown the step, so the two never disagree.
 */

export interface ConnectPromptContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface ConnectPromptDependencies {
  readonly settings: SettingsStore;
  readonly sources: SourcesRepository;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export class ConnectPromptService {
  readonly #deps: ConnectPromptDependencies;
  readonly #clock: Clock;

  constructor(dependencies: ConnectPromptDependencies) {
    this.#deps = dependencies;
    this.#clock = dependencies.clock ?? systemClock;
  }

  /**
   * Whether the step is still owed, and which sources it would list.
   *
   * No capability check, like `GET /sources` itself: the screen has to decide
   * whether to appear before it knows what the account may do, and the answer is
   * one boolean about this installation, not about a person.
   */
  status(): SourceConnectPrompt {
    return { pending: this.#seenAt() === undefined, keys: this.#keys() };
  }

  /**
   * "I have signed in", or "Skip for now" — the same answer either way.
   *
   * Skipping is deliberately as final as finishing. The step is an offer, not a
   * task: a professor who skipped it can sign in from Admin → Sources whenever
   * they like, and being asked again at every start would be the app nagging
   * about something it cannot do for them.
   */
  markSeen(context: ConnectPromptContext): SourceConnectPrompt {
    assertCan(context.actor, 'source.manage');
    const already = this.#seenAt();
    if (already === undefined) {
      const at = nowMs(this.#clock);
      withAudit(
        this.#deps.audit,
        {
          actorKind: 'USER',
          actorUserId: context.actor.id,
          action: 'source.connect_prompt.finished',
          entityKind: 'setting',
          entityId: SOURCE_CONNECT_PROMPT_SEEN_AT.key,
          summary: 'Finished the one-time “Connect your sources” step',
          requestId: context.requestId ?? null,
        },
        () => {
          this.#deps.settings.set(SOURCE_CONNECT_PROMPT_SEEN_AT, String(at), context.actor.id);
        },
      );
    }
    return { pending: false, keys: this.#keys() };
  }

  /** The stored moment, or `undefined` while the step is owed. */
  #seenAt(): number | undefined {
    const raw = this.#deps.settings.get(SOURCE_CONNECT_PROMPT_SEEN_AT).trim();
    if (raw.length === 0) {
      return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    // An unreadable value is treated as "not seen": asking once more is a smaller
    // fault than never offering the step on an installation that needs it.
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  /** Enabled sources that may hold a session at all (R74: Devfolio, Unstop). */
  #keys(): string[] {
    return this.#deps.sources
      .list()
      .filter((source) => source.isEnabled && sessionConfigOf(source) !== undefined)
      .map((source) => source.key);
  }
}
