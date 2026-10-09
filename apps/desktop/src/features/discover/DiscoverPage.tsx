import type { RankedEventListItem } from '@compintel/contracts';
import { Outlet, useMatch, useNavigate, useSearch } from '@tanstack/react-router';
import { AlertTriangle, Compass, SearchX } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { AssignProvider, useAssign } from '../competitions/assign/assign-context.js';
import { isApiProblem } from '../../api/problem.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Skeleton } from '../../components/Skeleton.js';
import { formatCount } from '../../lib/count.js';
import { useNow } from '../../lib/use-now.js';
import { EventList } from './EventList.js';
import { FilterBar } from './FilterBar.js';
import { effectiveQuery, FEATURED_VIEWS, filtersToSave, presetOf, TABS } from './presets.js';
import { filtersOfSaved, hasChips, readChip, writeChip, type FilterQuery } from './query.js';
import { SaveSearchButton } from './saved/SaveSearchButton.js';
import { SavedSearchesMenu } from './saved/SavedSearchesMenu.js';
import { useSavedSearches } from './saved/use-saved-searches.js';
import { type DiscoverSearch } from './search-state.js';
import { Tabs } from './Tabs.js';
import { useEventActions } from './use-event-actions.js';
import { useEventSearch } from './use-event-search.js';

/** §16.2's dense list pages 25 at a time, with "Load more". */
export const PAGE_SIZE = 25;
const PANEL_ID = 'discover-panel';

/**
 * Discover (§16.2, WP-16a). The screen is a function of its search state —
 * tab, Featured view, filters — and everything else is derived: the preset
 * query, the list, the chips, the counts. Business rules live in the modules
 * next to it (`presets`, `query`, `urgency`, `cache`); this file only lays them
 * out and connects them to the router.
 */
/** WP-19: the assign flow is opened from the cards, the **A** key and the drawer. */
export function DiscoverPage(): React.JSX.Element {
  return (
    <AssignProvider>
      <DiscoverScreen />
    </AssignProvider>
  );
}

function DiscoverScreen(): React.JSX.Element {
  const assign = useAssign();
  const search = useSearch({ from: '/discover' });
  const navigate = useNavigate();
  const drawer = useMatch({ from: '/discover/event/$eventId', shouldThrow: false });
  const openedId = useRef<string | undefined>(undefined);
  const preset = presetOf(search.tab, search.view);
  const query = effectiveQuery(search.tab, search.view, search.filters, PAGE_SIZE);
  const result = useEventSearch(query);
  const actions = useEventActions();
  const saved = useSavedSearches();
  const toSave = filtersToSave(search.tab, search.view, search.filters);

  const update = (patch: Partial<DiscoverSearch>): void => {
    void navigate({ to: '/discover', search: { ...search, ...patch } });
  };
  const setFilters = (filters: FilterQuery): void => {
    update({ filters });
  };
  const open = (item: RankedEventListItem): void => {
    openedId.current = item.id;
    void navigate({
      to: '/discover/event/$eventId',
      params: { eventId: item.id },
      search,
    });
  };

  // When the drawer closes, focus goes back to the card that opened it.
  const drawerOpen = drawer !== undefined;
  useEffect(() => {
    if (drawerOpen || openedId.current === undefined) return;
    document.querySelector<HTMLElement>(`[data-event-id="${openedId.current}"] article`)?.focus();
  }, [drawerOpen]);

  const now = useNow();
  const total = result.total;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-medium">Discover</h1>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          label="Discover views"
          items={TABS}
          selected={search.tab}
          onSelect={(tab) => {
            update({ tab });
          }}
          panelId={PANEL_ID}
        />
        <SavedSearchesMenu
          searches={saved}
          currentFilters={toSave}
          onApply={(chosen) => {
            if (chosen.query === null) return;
            // A saved search is its filters alone, so it opens on All events,
            // the one tab that adds none of its own (R112: what it matches).
            update({ tab: 'all', filters: filtersOfSaved(chosen.query) });
          }}
        />
      </div>
      {search.tab === 'featured' && (
        <Tabs
          label="Featured"
          items={FEATURED_VIEWS}
          selected={search.view}
          onSelect={(view) => {
            update({ view });
          }}
          panelId={PANEL_ID}
          size="sm"
        />
      )}

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <FilterBar filters={search.filters} facets={result.facets} onChange={setFilters} />
        </div>
        <SaveSearchButton searches={saved} filters={toSave} facets={result.facets} />
      </div>

      {/* The count is announced politely whenever a filter changes it. */}
      <p id="discover-count" role="status" aria-live="polite" className="text-sm text-fg-muted">
        {total === undefined
          ? ''
          : `${formatCount(total, result.totalIsApproximate)} ${total === 1 ? 'event' : 'events'}`}
        {result.correction === undefined ? '' : ` · ${result.correction}`}
      </p>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${search.tab}`}>
        {result.isPending ? (
          <Skeleton lines={8} label="Loading events" />
        ) : result.error !== null && result.items.length === 0 ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-lg border border-danger p-4"
          >
            <p className="flex items-center gap-2 font-medium text-danger">
              <AlertTriangle aria-hidden="true" className="size-4" />
              {isApiProblem(result.error) ? result.error.title : 'Events could not be loaded'}
            </p>
            {isApiProblem(result.error) && result.error.detail !== undefined && (
              <p className="text-fg-muted">{result.error.detail}</p>
            )}
            <button
              type="button"
              onClick={result.retry}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
            >
              Retry
            </button>
          </div>
        ) : result.items.length === 0 ? (
          <Empty
            filters={search.filters}
            onFilters={setFilters}
            onAdd={() => void navigate({ to: '/events/new' })}
          />
        ) : (
          <EventList
            items={result.items}
            groupBy={preset.groupBy}
            now={now}
            hasMore={result.hasMore}
            isLoadingMore={result.isLoadingMore}
            onLoadMore={result.loadMore}
            onOpen={open}
            onSave={actions.toggleSave}
            onHide={actions.hide}
            onAssign={(item) => {
              assign.open({ id: item.id, title: item.title });
            }}
            keysEnabled={!drawerOpen}
          />
        )}
      </div>

      <Outlet />
    </div>
  );
}

function Empty({
  filters,
  onFilters,
  onAdd,
}: {
  filters: FilterQuery;
  onFilters: (filters: FilterQuery) => void;
  onAdd: () => void;
}): React.JSX.Element {
  if (hasChips(filters)) {
    // Name the filter most likely to be the culprit: a radius is the narrowest.
    const distance = readChip(filters, 'distance');
    return distance.km === undefined ? (
      <EmptyState
        icon={SearchX}
        title="No events match these filters"
        description="Try fewer filters, or include events whose details are unknown."
        action={{
          label: 'Clear all filters',
          onAction: () => {
            onFilters({ text: filters.text });
          },
        }}
      />
    ) : (
      <EmptyState
        icon={SearchX}
        title="No events match these filters"
        description={`Nothing within ${String(distance.km)} km matches. Clear the distance filter to see events further away.`}
        action={{
          label: 'Clear the distance filter',
          onAction: () => {
            onFilters(writeChip(filters, 'distance', { km: undefined, includeUnknown: false }));
          },
        }}
      />
    );
  }
  return (
    <EmptyState
      icon={Compass}
      title="Nothing yet"
      description="Sources run every 15 minutes; new events appear here as they are found. You can also add one by hand."
      action={{ label: 'Add an event', onAction: onAdd }}
    />
  );
}
