import { EVENT_TYPES, type RankedEventListItem } from '@compintel/contracts';

import { formatIsoDay, weekOf } from './format.js';
import { EVENT_TYPE_LABELS } from './labels.js';

/**
 * How a tab sections its list (§16.2): *All events* by event type, the Contest
 * Calendar by week of the start date, Featured not at all. Loaded items are
 * grouped as they arrive, so "Load more" can add to an existing section.
 */

export type GroupBy = 'none' | 'eventType' | 'week';

export interface ItemGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly items: readonly RankedEventListItem[];
}

export function groupItems(items: readonly RankedEventListItem[], by: GroupBy): ItemGroup[] {
  if (by === 'none') return [{ key: 'all', label: undefined, items }];
  if (by === 'eventType') {
    return EVENT_TYPES.map((type) => ({
      key: type,
      label: EVENT_TYPE_LABELS[type],
      items: items.filter((item) => item.eventType === type),
    })).filter((group) => group.items.length > 0);
  }
  // By week: the list is sorted by start, so weeks arrive in order; undated rounds come last.
  const groups = new Map<string, RankedEventListItem[]>();
  for (const item of items) {
    const key = item.startsAt === null ? 'undated' : weekOf(item.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, groupItems]) => ({
    key,
    label: key === 'undated' ? 'Start date not announced' : `Week of ${formatIsoDay(key)}`,
    items: groupItems,
  }));
}
