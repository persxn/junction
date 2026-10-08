import type { RankedEventListItem } from '@compintel/contracts';
import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useGlobalHotkeys, type Hotkey } from '../../lib/hotkeys.js';
import { EventCard } from './EventCard.js';
import { groupItems, type GroupBy } from './grouping.js';

export interface EventListProps {
  readonly items: readonly RankedEventListItem[];
  readonly groupBy: GroupBy;
  readonly now: number;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly onOpen: (item: RankedEventListItem) => void;
  readonly onSave: (item: RankedEventListItem) => void;
  readonly onHide: (item: RankedEventListItem) => void;
  /** WP-19: the card's Assign and the **A** key. */
  readonly onAssign: (item: RankedEventListItem) => void;
  /** Keyboard shortcuts are off while something (the drawer) sits over the list. */
  readonly keysEnabled: boolean;
}

/**
 * The result list (§16.2, §16.3's keyboard model). One card is the tab stop —
 * a roving tabindex — and J/K move it, focusing and scrolling the card into
 * view; Enter on a card opens it, S saves the selected one. "Load more"
 * appends the next cursor page; there is no virtualization (25 per page).
 */
export function EventList({
  items,
  groupBy,
  now,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onOpen,
  onSave,
  onHide,
  onAssign,
  keysEnabled,
}: EventListProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const cards = useRef(new Map<string, HTMLElement>());
  const groups = useMemo(() => groupItems(items, groupBy), [items, groupBy]);
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selected = ordered.find((item) => item.id === selectedId) ?? ordered[0];

  const select = useCallback((item: RankedEventListItem | undefined): void => {
    if (item === undefined) return;
    setSelectedId(item.id);
    const element = cards.current.get(item.id);
    element?.focus();
    element?.scrollIntoView({ block: 'nearest' });
  }, []);

  const hotkeys = useMemo<readonly Hotkey[]>(() => {
    if (!keysEnabled) return [];
    const index = selected === undefined ? -1 : ordered.indexOf(selected);
    return [
      {
        key: 'j',
        onPress: () => {
          select(ordered[Math.min(ordered.length - 1, index + 1)]);
        },
      },
      {
        key: 'k',
        onPress: () => {
          select(ordered[Math.max(0, index - 1)]);
        },
      },
      {
        key: 's',
        onPress: () => {
          if (selected !== undefined) onSave(selected);
        },
      },
      {
        key: 'a',
        onPress: () => {
          if (selected !== undefined) onAssign(selected);
        },
      },
    ];
  }, [keysEnabled, ordered, selected, onSave, onAssign, select]);
  useGlobalHotkeys(hotkeys);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label ?? 'Results'}>
          {/* Always an h2 — a visible section name, or a hidden "Results" — so card titles (h3) never skip a level. */}
          <h2
            className={
              group.label === undefined ? 'sr-only' : 'mb-2 text-sm font-medium text-fg-muted'
            }
          >
            {group.label ?? 'Results'}
          </h2>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <li key={item.id} data-event-id={item.id}>
                <EventCard
                  item={item}
                  now={now}
                  selected={item.id === selected?.id}
                  cardRef={(element) => {
                    if (element === null) cards.current.delete(item.id);
                    else cards.current.set(item.id, element);
                  }}
                  onFocusCard={() => {
                    setSelectedId(item.id);
                  }}
                  onOpen={() => {
                    setSelectedId(item.id);
                    onOpen(item);
                  }}
                  onSave={() => {
                    onSave(item);
                  }}
                  onHide={() => {
                    onHide(item);
                  }}
                  onAssign={() => {
                    setSelectedId(item.id);
                    onAssign(item);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="mx-auto flex items-center gap-2 rounded-md border border-line px-4 py-1.5 hover:bg-surface-hover disabled:opacity-60"
        >
          {isLoadingMore && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {isLoadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
