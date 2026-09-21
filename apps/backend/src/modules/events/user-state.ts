import type {
  EventUserState,
  HideInput,
  WatchlistEntry,
  WatchlistInput,
} from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { eventNotFound } from './errors.js';
import type { EventsRepository } from './repository.js';

/**
 * A professor's own Save and Hide (§6.2 `watchlist_items`, `event_user_state`;
 * §10.2 "Save/watch, hide events — own"; WP-16a).
 *
 * Scoping is structural, not a check: every statement is keyed by the caller's
 * id, and no route carries a user id, so there is no way to name somebody
 * else's row. Every write is idempotent — a Save twice is one row, a Hide
 * twice is one hidden flag — which is what makes the UI's optimistic update and
 * its Undo safe to repeat. Personal preferences are not audited (§10.2 marks
 * only shared writes "audited").
 *
 * The event must be one the caller can see: a hidden, merged or unknown id is
 * `EVENT_NOT_FOUND`, the same answer `GET /events/:id` gives.
 */

export interface UserStateContext {
  readonly actor: Principal;
}

export class EventUserStateService {
  readonly #db: DatabaseHandle;
  readonly #events: EventsRepository;
  readonly #clock: Clock;

  constructor(deps: { db: DatabaseHandle; events: EventsRepository; clock?: Clock }) {
    this.#db = deps.db;
    this.#events = deps.events;
    this.#clock = deps.clock ?? systemClock;
  }

  #visible(eventId: string): void {
    if (this.#events.getVisibleEventById(eventId) === undefined) {
      throw eventNotFound(eventId);
    }
  }

  watch(context: UserStateContext, eventId: string, input: WatchlistInput): WatchlistEntry {
    // OWN: the row is keyed by the caller, so the caller owns it by construction.
    assertCan(context.actor, 'event.save', { isOwner: true });
    this.#visible(eventId);
    const note = input.note === undefined || input.note === '' ? null : input.note;
    this.#db.raw
      .prepare(
        `INSERT INTO watchlist_items (user_id, event_id, note, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, event_id) DO UPDATE SET note = excluded.note`,
      )
      .run(context.actor.id, eventId, note, nowMs(this.#clock));
    const row = this.#db.raw
      .prepare(
        'SELECT note, added_at AS addedAt FROM watchlist_items WHERE user_id = ? AND event_id = ?',
      )
      .get(context.actor.id, eventId) as { note: string | null; addedAt: number };
    return { eventId, note: row.note, addedAt: row.addedAt };
  }

  /** Removing a save that is not there is not an error: the outcome is the same. */
  unwatch(context: UserStateContext, eventId: string): void {
    // OWN: the row is keyed by the caller, so the caller owns it by construction.
    assertCan(context.actor, 'event.save', { isOwner: true });
    this.#visible(eventId);
    this.#db.raw
      .prepare('DELETE FROM watchlist_items WHERE user_id = ? AND event_id = ?')
      .run(context.actor.id, eventId);
  }

  hide(context: UserStateContext, eventId: string, input: HideInput): EventUserState {
    return this.#setHidden(context, eventId, true, input.reason ?? null);
  }

  /**
   * Unhide is allowed on an event the caller has hidden even though
   * `excludeHidden` no longer shows it to them — visibility here is the
   * event's, not the caller's filter.
   */
  unhide(context: UserStateContext, eventId: string): EventUserState {
    return this.#setHidden(context, eventId, false, null);
  }

  #setHidden(
    context: UserStateContext,
    eventId: string,
    hidden: boolean,
    reason: string | null,
  ): EventUserState {
    assertCan(context.actor, 'event.hide', { isOwner: true });
    this.#visible(eventId);
    const hiddenReason = hidden && reason !== '' ? reason : null;
    this.#db.raw
      .prepare(
        `INSERT INTO event_user_state (user_id, event_id, is_hidden, hidden_reason) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, event_id) DO UPDATE SET is_hidden = excluded.is_hidden,
           hidden_reason = excluded.hidden_reason`,
      )
      .run(context.actor.id, eventId, hidden ? 1 : 0, hiddenReason);
    return { eventId, hidden, hiddenReason };
  }
}
