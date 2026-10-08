import { useCallback, useMemo, useRef, useState } from 'react';

import { useGlobalHotkeys, type Hotkey } from './hotkeys.js';

/**
 * §16.3's list keyboard model for a table: one row is the tab stop (a roving
 * tabindex), J and K move it — focusing and scrolling it into view — and the
 * row's own Enter handler opens it. Shared by the Students and Teams tables.
 */
export interface RovingRows<T extends { readonly id: string }> {
  readonly selected: T | undefined;
  readonly rowProps: (item: T) => {
    ref: (element: HTMLTableRowElement | null) => void;
    tabIndex: number;
    'data-selected': boolean;
    onFocus: () => void;
  };
}

export function useRovingRows<T extends { readonly id: string }>(
  items: readonly T[],
  enabled: boolean,
): RovingRows<T> {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const select = useCallback((item: T | undefined): void => {
    if (item === undefined) return;
    setSelectedId(item.id);
    const row = rows.current.get(item.id);
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  }, []);

  const hotkeys = useMemo<readonly Hotkey[]>(() => {
    if (!enabled) return [];
    const index = selected === undefined ? -1 : items.indexOf(selected);
    return [
      {
        key: 'j',
        onPress: () => {
          select(items[Math.min(items.length - 1, index + 1)]);
        },
      },
      {
        key: 'k',
        onPress: () => {
          select(items[Math.max(0, index - 1)]);
        },
      },
    ];
  }, [enabled, items, selected, select]);
  useGlobalHotkeys(hotkeys);

  return {
    selected,
    rowProps: (item) => ({
      ref: (element) => {
        if (element === null) rows.current.delete(item.id);
        else rows.current.set(item.id, element);
      },
      tabIndex: item.id === selected?.id ? 0 : -1,
      'data-selected': item.id === selected?.id,
      onFocus: () => {
        setSelectedId(item.id);
      },
    }),
  };
}
