import { EventFilters } from '@compintel/contracts';

import type { FilterQuery } from './query.js';
import { FEATURED_VIEWS, TABS, type DiscoverTab, type FeaturedView } from './presets.js';

/**
 * Discover's router search state: which tab, which Featured view, and the
 * filters as an `EventQuery` fragment. Everything the screen shows is derived
 * from these three, so restoring them restores the screen (a later saved
 * search, WP-24, stores exactly `filters`).
 *
 * Parsing is forgiving by design: a value that no longer fits (an older build
 * wrote it) falls back to the default rather than breaking navigation.
 */

export interface DiscoverSearch {
  readonly tab: DiscoverTab;
  readonly view: FeaturedView;
  readonly filters: FilterQuery;
}

export const DEFAULT_SEARCH: DiscoverSearch = { tab: 'featured', view: 'recommended', filters: {} };

export function parseDiscoverSearch(raw: Record<string, unknown>): DiscoverSearch {
  const tab = TABS.find((candidate) => candidate.id === raw.tab)?.id ?? DEFAULT_SEARCH.tab;
  const view =
    FEATURED_VIEWS.find((candidate) => candidate.id === raw.view)?.id ?? DEFAULT_SEARCH.view;
  const parsed = EventFilters.safeParse(raw.filters ?? {});
  return { tab, view, filters: parsed.success ? parsed.data : {} };
}

/**
 * Discover's search state with new free text (`undefined` keeps the text as it
 * is, `''` clears it) — for the top bar and the palette, which navigate to
 * Discover from anywhere and so see only a partial previous state.
 */
export function discoverSearch(
  previous: Partial<DiscoverSearch>,
  text: string | undefined,
): DiscoverSearch {
  const filters: FilterQuery = { ...(previous.filters ?? {}) };
  if (text !== undefined) {
    if (text === '') delete filters.text;
    else filters.text = text.slice(0, 200);
  }
  return {
    tab: previous.tab ?? DEFAULT_SEARCH.tab,
    view: previous.view ?? DEFAULT_SEARCH.view,
    filters,
  };
}
