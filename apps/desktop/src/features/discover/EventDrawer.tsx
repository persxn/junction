import type { RankedEventListItem } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { PanelRightOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useGlobalHotkeys, type Hotkey } from '../../lib/hotkeys.js';
import { flatItems, type Pages } from './cache.js';

/**
 * The event drawer's place (§16.2: "detail drawer on the right, so the list
 * keeps its place"). WP-16a only proves the route and the keyboard: Enter opens
 * it over the list without unmounting the list, Esc closes it and focus goes
 * back to the card. Its contents — facts, provenance, "Sources disagree",
 * deadlines, sources, history — are WP-16b's.
 */
export function EventDrawer(): React.JSX.Element {
  const { eventId } = useParams({ from: '/discover/event/$eventId' });
  const navigate = useNavigate();
  const search = useSearch({ from: '/discover' });
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);

  const item = useMemo<RankedEventListItem | undefined>(() => {
    for (const [, data] of client.getQueriesData<Pages>({ queryKey: ['events', 'list'] })) {
      const found = flatItems(data).find((candidate) => candidate.id === eventId);
      if (found !== undefined) return found;
    }
    return undefined;
  }, [client, eventId]);

  const close = useCallback((): void => {
    void navigate({ to: '/discover', search });
  }, [navigate, search]);

  const hotkeys = useMemo<readonly Hotkey[]>(
    () => [{ key: 'Escape', allowWhileTyping: true, onPress: close }],
    [close],
  );
  useGlobalHotkeys(hotkeys);

  useEffect(() => {
    heading.current?.focus();
  }, [eventId]);

  return (
    <aside
      aria-labelledby="event-drawer-title"
      className="fixed top-[var(--ci-topbar-height)] right-0 bottom-0 z-20 flex w-[min(480px,90vw)] flex-col gap-3 border-l border-line bg-surface-raised p-4 shadow-[var(--ci-shadow-popover)]"
    >
      <div className="flex items-start gap-2">
        <h2
          id="event-drawer-title"
          ref={heading}
          tabIndex={-1}
          className="flex-1 text-lg font-medium"
        >
          {item?.title ?? 'Event'}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close event details"
          aria-keyshortcuts="Escape"
          className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p className="flex items-center gap-2 text-fg-muted">
        <PanelRightOpen aria-hidden="true" className="size-4" />
        The full event view — facts with their sources, deadlines and history — arrives in the next
        update.
      </p>
    </aside>
  );
}
