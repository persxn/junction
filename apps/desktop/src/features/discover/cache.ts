import type { RankedEventListItem, SearchResponse } from '@compintel/contracts';
import type { InfiniteData } from '@tanstack/react-query';

/**
 * Pure edits to the cached pages of a search, for optimistic updates (§16.3).
 * They never mutate: each returns new pages, so TanStack Query sees a change
 * and a rollback is simply putting the old value back.
 */

export type Pages = InfiniteData<SearchResponse, string | undefined>;

/** Where an item sat, so Undo can put it back in the same place. */
export interface Position {
  readonly page: number;
  readonly index: number;
  readonly item: RankedEventListItem;
}

export function setWatchlisted(data: Pages, id: string, watchlisted: boolean): Pages {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === id ? { ...item, watchlisted } : item)),
    })),
  };
}

export function removeItem(
  data: Pages,
  id: string,
): { data: Pages; position: Position | undefined } {
  let position: Position | undefined;
  const pages = data.pages.map((page, pageIndex) => {
    const index = page.items.findIndex((item) => item.id === id);
    if (index === -1) return page;
    position = { page: pageIndex, index, item: page.items[index]! };
    return {
      ...page,
      items: page.items.filter((item) => item.id !== id),
      total: Math.max(0, page.total - 1),
    };
  });
  return { data: { ...data, pages }, position };
}

/** Puts an item back where it was; a no-op if it is already there. */
export function restoreItem(data: Pages, position: Position): Pages {
  if (data.pages.some((page) => page.items.some((item) => item.id === position.item.id))) {
    return data;
  }
  const pages = data.pages.map((page, pageIndex) => {
    if (pageIndex !== position.page) return page;
    const items = [...page.items];
    items.splice(Math.min(position.index, items.length), 0, position.item);
    return { ...page, items, total: page.total + 1 };
  });
  return { ...data, pages };
}

/** Every loaded item, in order, without duplicates (a page boundary can repeat a row after a write). */
export function flatItems(data: Pages | undefined): RankedEventListItem[] {
  if (data === undefined) return [];
  const seen = new Set<string>();
  const out: RankedEventListItem[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
