import type { z } from 'zod';

import { EventQuery } from './search.js';

/**
 * What a person chooses on the Discover screen: an `EventQuery` without paging
 * or sort (WP-16a). The screen keeps it in the router's search state, so a saved
 * search (WP-24) can restore a screen verbatim from exactly this shape.
 */
export const EventFilters = EventQuery.omit({ cursor: true, limit: true, sort: true }).partial();
export type EventFilters = z.infer<typeof EventFilters>;
