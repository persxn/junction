import {
  CLOSING_SOON_REGISTRATION,
  type EventQueryInput,
  type SearchSort,
} from '@compintel/contracts';

import type { FilterQuery } from './query.js';

/**
 * The Discover tabs (§16.2) as named preset queries, in one module.
 *
 * A preset supplies a sort and the filters that *define* the tab; the chips add
 * to it, and where both set a field the chip wins, because the person chose it
 * after the tab did. Every preset hides what the professor hid
 * (`excludeHidden`) — a hidden event leaving Discover is the point of Hide.
 */

export type DiscoverTab = 'featured' | 'all' | 'calendar';
export type FeaturedView = 'nearby' | 'closing' | 'new' | 'recommended';

export const TABS: readonly { readonly id: DiscoverTab; readonly label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'all', label: 'All events' },
  { id: 'calendar', label: 'Contest Calendar' },
];

export const FEATURED_VIEWS: readonly { readonly id: FeaturedView; readonly label: string }[] = [
  { id: 'nearby', label: 'Nearby' },
  { id: 'closing', label: 'Closing soon' },
  { id: 'new', label: 'New' },
  { id: 'recommended', label: 'Recommended' },
];

/** "Nearby" is D-06's 100 km ring; the chip can widen or narrow it. */
export const NEARBY_KM = 100;

interface Preset {
  readonly sort: SearchSort;
  readonly filters: FilterQuery;
  /** How the list is sectioned. */
  readonly groupBy: 'none' | 'eventType' | 'week';
}

const FEATURED: Readonly<Record<FeaturedView, Preset>> = {
  nearby: { sort: 'DISTANCE', filters: { maxDistanceKm: NEARBY_KM }, groupBy: 'none' },
  closing: {
    sort: 'DEADLINE',
    // The Dashboard's "Closing soon" tile uses the same definition (R107).
    filters: { registration: CLOSING_SOON_REGISTRATION },
    groupBy: 'none',
  },
  new: { sort: 'NEWEST', filters: {}, groupBy: 'none' },
  // WP-15b explains every RELEVANCE result, so Recommended is simply that, with no text.
  recommended: { sort: 'RELEVANCE', filters: {}, groupBy: 'none' },
};

export function presetOf(tab: DiscoverTab, view: FeaturedView): Preset {
  switch (tab) {
    case 'featured':
      return FEATURED[view];
    case 'all':
      return { sort: 'DEADLINE', filters: {}, groupBy: 'eventType' };
    case 'calendar':
      // D-08: rated rounds live here, not in the feed — exactly the recurring
      // ones (`recurringOnly`, pre-M2b), by start date.
      return { sort: 'START', filters: { recurringOnly: true }, groupBy: 'week' };
  }
}

/** The request the list sends: preset, then the person's filters, then paging. */
export function effectiveQuery(
  tab: DiscoverTab,
  view: FeaturedView,
  filters: FilterQuery,
  limit: number,
): EventQueryInput {
  const preset = presetOf(tab, view);
  return {
    ...preset.filters,
    ...filters,
    includeUnknown: { ...preset.filters.includeUnknown, ...filters.includeUnknown },
    registration: filters.registration ?? preset.filters.registration,
    excludeHidden: true,
    sort: preset.sort,
    limit,
  };
}

/**
 * What "Save this search" stores (WP-24): the tab's defining filters folded
 * into the person's chips, so the saved search matches what the screen shows
 * (a search saved on "Closing soon" keeps its registration filter, now as a
 * chip). The tab's sort is not part of it.
 */
export function filtersToSave(
  tab: DiscoverTab,
  view: FeaturedView,
  filters: FilterQuery,
): FilterQuery {
  const {
    excludeHidden: _hidden,
    sort: _sort,
    limit: _limit,
    ...rest
  } = effectiveQuery(tab, view, filters, 1);
  return rest;
}
