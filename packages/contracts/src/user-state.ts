import { z } from 'zod';

import { Uuid7 } from './ids.js';

/**
 * A professor's own relationship to an event (§6.2 `watchlist_items`,
 * `event_user_state`; §10.2 "Save/watch, hide events — own"). Every route that
 * writes these rows is scoped to the caller: there is no user id in any path or
 * body, so one professor cannot name another's rows at all.
 */

/** `PUT /events/:id/watchlist` — idempotent; a second PUT only replaces the note. */
export const WatchlistInput = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type WatchlistInput = z.infer<typeof WatchlistInput>;

export const WatchlistEntry = z
  .object({
    eventId: Uuid7,
    note: z.string().nullable(),
    addedAt: z.int(),
  })
  .strict();
export type WatchlistEntry = z.infer<typeof WatchlistEntry>;

/** `POST /events/:id/hide` — idempotent. */
export const HideInput = z
  .object({
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type HideInput = z.infer<typeof HideInput>;

/** What hide/unhide answer: the caller's state for that event after the write. */
export const EventUserState = z
  .object({
    eventId: Uuid7,
    hidden: z.boolean(),
    hiddenReason: z.string().nullable(),
  })
  .strict();
export type EventUserState = z.infer<typeof EventUserState>;
