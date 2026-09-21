import type { RankedEventListItem } from '@compintel/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { hideEvent, saveEvent, unhideEvent, unsaveEvent } from '../../api/search.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { removeItem, restoreItem, setWatchlisted, type Pages, type Position } from './cache.js';

/**
 * Save and Hide, optimistic with Undo (§16.3, WP-16a step 8).
 *
 * The row changes the moment the key is pressed; the request follows. Success
 * leaves a toast whose Undo reverses the write. Failure puts the row back and
 * says what happened — a professor never ends up looking at a state the server
 * does not hold. Every cached list is edited, not only the visible one, so
 * switching tabs does not show a stale star.
 */

const LISTS: QueryKey = ['events', 'list'];

export interface EventActions {
  readonly toggleSave: (item: RankedEventListItem) => void;
  readonly hide: (item: RankedEventListItem) => void;
}

function failure(cause: unknown): string {
  return isApiProblem(cause) ? (cause.detail ?? cause.title) : 'The local service did not answer.';
}

export function useEventActions(): EventActions {
  const client = useQueryClient();
  const connection = useBackendConnection();
  const toast = useToast();

  const editLists = useCallback(
    (edit: (data: Pages, key: QueryKey) => Pages): void => {
      for (const [key, data] of client.getQueriesData<Pages>({ queryKey: LISTS })) {
        if (data !== undefined) client.setQueryData(key, edit(data, key));
      }
    },
    [client],
  );

  /** One Save or Unsave, optimistic; `false` when it failed and was rolled back. */
  const writeSaved = useCallback(
    async (item: RankedEventListItem, saved: boolean): Promise<boolean> => {
      editLists((data) => setWatchlisted(data, item.id, saved));
      try {
        if (saved) await saveEvent(connection, item.id);
        else await unsaveEvent(connection, item.id);
        return true;
      } catch (cause) {
        editLists((data) => setWatchlisted(data, item.id, !saved));
        toast.show({
          tone: 'danger',
          title: saved ? `Could not save “${item.title}”` : `Could not unsave “${item.title}”`,
          description: failure(cause),
        });
        return false;
      }
    },
    [connection, editLists, toast],
  );

  /** The same, followed by a toast whose Undo writes the opposite. */
  const setSaved = useCallback(
    async (item: RankedEventListItem, saved: boolean): Promise<void> => {
      if (!(await writeSaved(item, saved))) return;
      toast.show({
        tone: 'success',
        title: saved ? `Saved “${item.title}”` : `Removed “${item.title}” from saved`,
        action: {
          label: 'Undo',
          onAction: () => {
            void writeSaved(item, !saved);
          },
        },
      });
    },
    [toast, writeSaved],
  );

  const unhide = useCallback(
    async (item: RankedEventListItem, positions: ReadonlyMap<string, Position>): Promise<void> => {
      const restore = (): void => {
        editLists((data, key) => {
          const position = positions.get(JSON.stringify(key));
          return position === undefined ? data : restoreItem(data, position);
        });
      };
      restore();
      try {
        await unhideEvent(connection, item.id);
      } catch (cause) {
        void client.invalidateQueries({ queryKey: LISTS });
        toast.show({
          tone: 'danger',
          title: `Could not unhide “${item.title}”`,
          description: failure(cause),
        });
      }
    },
    [client, connection, editLists, toast],
  );

  const hide = useCallback(
    async (item: RankedEventListItem): Promise<void> => {
      const positions = new Map<string, Position>();
      editLists((data, key) => {
        const removed = removeItem(data, item.id);
        if (removed.position !== undefined) positions.set(JSON.stringify(key), removed.position);
        return removed.data;
      });
      try {
        await hideEvent(connection, item.id);
      } catch (cause) {
        editLists((data, key) => {
          const position = positions.get(JSON.stringify(key));
          return position === undefined ? data : restoreItem(data, position);
        });
        toast.show({
          tone: 'danger',
          title: `Could not hide “${item.title}”`,
          description: failure(cause),
        });
        return;
      }
      // A hidden row never just vanishes: it says where it went and how to bring it back.
      toast.show({
        tone: 'info',
        title: `Hidden — “${item.title}”`,
        action: {
          label: 'Undo',
          onAction: () => {
            void unhide(item, positions);
          },
        },
      });
    },
    [connection, editLists, toast, unhide],
  );

  return useMemo(
    () => ({
      toggleSave: (item) => {
        void setSaved(item, !item.watchlisted);
      },
      hide: (item) => {
        void hide(item);
      },
    }),
    [hide, setSaved],
  );
}
