import { useCallback, useState } from 'react';

import { readLocal, writeLocal } from '../lib/storage.js';

/** Per-viewer convenience, like the theme: it never leaves this machine. */
export const RAIL_STORAGE_KEY = 'compintel.rail.collapsed';

export interface RailState {
  readonly collapsed: boolean;
  readonly toggle: () => void;
}

/**
 * Whether the left rail is collapsed, remembered across launches (§16.1: the
 * rail is collapsible). An unreadable or empty store means expanded, which is
 * the state that needs no explanation.
 */
export function useRail(): RailState {
  const [collapsed, setCollapsed] = useState(() => readLocal(RAIL_STORAGE_KEY) === 'true');

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      writeLocal(RAIL_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
