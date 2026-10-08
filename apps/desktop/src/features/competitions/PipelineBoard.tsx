import {
  ENGAGEMENT_STATUS_LABELS,
  type CompetitionListItem,
  type EngagementStatus,
} from '@compintel/contracts';
import { Ban, CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { canDrop, columnsOf, movedText, whoOf } from './board-model.js';
import { statusIcon } from './labels.js';
import { MoveMenu, type MoveMenuHandle } from './MoveMenu.js';
import { NextDeadline } from './NextDeadline.js';
import type { MoveResult } from './use-competition-actions.js';

/**
 * The pipeline board (§16.2, WP-19 step 6). Columns Considering → Completed;
 * a card is the event, the team or student, the primary mentor and the next
 * date. Drag with native drag events: while dragging, a column the card may
 * not enter says "Not allowed" with an icon. From the keyboard: arrows move
 * between cards and columns, M opens "Move to…", Enter opens the competition;
 * every move is announced. A refusal returns the card with the reason inline.
 */

export interface PipelineBoardProps {
  readonly items: readonly CompetitionListItem[];
  readonly now: number;
  readonly onOpen: (item: CompetitionListItem) => void;
  readonly onMove: (item: CompetitionListItem, to: EngagementStatus) => Promise<MoveResult>;
}

export function PipelineBoard({
  items,
  now,
  onOpen,
  onMove,
}: PipelineBoardProps): React.JSX.Element {
  const columns = columnsOf(items);
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<CompetitionListItem | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');
  const cards = useRef(new Map<string, HTMLElement>());
  const menus = useRef(new Map<string, MoveMenuHandle>());
  // A moved card is a new element in another column; focus follows it there.
  const refocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = refocus.current;
    if (id === undefined) return;
    const element = cards.current.get(id);
    if (element !== undefined && document.activeElement !== element) {
      element.focus();
      refocus.current = undefined;
    }
  }, [items]);
  const tabStop = focusedId ?? columns.find((column) => column.items.length > 0)?.items[0]?.id;

  const focus = (id: string | undefined): void => {
    if (id === undefined) return;
    setFocusedId(id);
    cards.current.get(id)?.focus();
  };

  const move = (item: CompetitionListItem, to: EngagementStatus): void => {
    setErrors(({ [item.id]: _gone, ...rest }) => rest);
    void onMove(item, to).then((result) => {
      if (result.ok) setAnnouncement(movedText(whoOf(item), to));
      else if ('cancelled' in result) setAnnouncement(`${whoOf(item)} was not moved.`);
      else {
        setErrors((current) => ({ ...current, [item.id]: result.message }));
        setAnnouncement(`${whoOf(item)} was not moved. ${result.message}`);
      }
    });
  };

  const onCardKey = (event: React.KeyboardEvent, item: CompetitionListItem): void => {
    const col = columns.findIndex((column) => column.status === item.status);
    const row = columns[col]?.items.indexOf(item) ?? 0;
    const at = (c: number, r: number): string | undefined => {
      const list = columns[c]?.items ?? [];
      return list[Math.min(r, list.length - 1)]?.id;
    };
    const sideways = (step: number): string | undefined => {
      for (let c = col + step; c >= 0 && c < columns.length; c += step) {
        const id = at(c, row);
        if (id !== undefined) return id;
      }
      return undefined;
    };
    const handled: Record<string, () => void> = {
      ArrowDown: () => {
        focus(at(col, row + 1));
      },
      ArrowUp: () => {
        focus(at(col, Math.max(0, row - 1)));
      },
      ArrowRight: () => {
        focus(sideways(1));
      },
      ArrowLeft: () => {
        focus(sideways(-1));
      },
      Enter: () => {
        onOpen(item);
      },
      m: () => menus.current.get(item.id)?.open(),
      M: () => menus.current.get(item.id)?.open(),
    };
    const action = handled[event.key];
    if (action === undefined || event.target !== event.currentTarget) return;
    event.preventDefault();
    action();
  };

  return (
    <div className="flex flex-col gap-2">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p className="sr-only" id="board-help">
        Arrow keys move between competitions and columns. M opens Move to, Enter opens the
        competition.
      </p>
      <div className="grid grid-cols-5 gap-3" aria-describedby="board-help">
        {columns.map((column) => {
          const Icon = statusIcon(column.status);
          const allowed = dragging === undefined || canDrop(dragging.status, column.status);
          const blocked = dragging !== undefined && dragging.status !== column.status && !allowed;
          return (
            <section
              key={column.status}
              aria-label={`${ENGAGEMENT_STATUS_LABELS[column.status]}, ${String(column.items.length)}`}
              data-column={column.status}
              onDragOver={(event) => {
                // Every column takes the drop; a refused one comes back from the
                // server with its reason, shown on the card.
                if (dragging !== undefined) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const item = dragging;
                setDragging(undefined);
                if (item === undefined || item.status === column.status) return;
                move(item, column.status);
              }}
              className={`flex min-h-48 flex-col gap-2 rounded-lg border p-2 ${
                blocked ? 'border-dashed border-line opacity-60' : 'border-line bg-surface-sunken'
              } ${dragging !== undefined && allowed && dragging.status !== column.status ? 'ring-2 ring-accent' : ''}`}
            >
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <Icon aria-hidden="true" className="size-4" />
                {ENGAGEMENT_STATUS_LABELS[column.status]}
                <span className="text-fg-muted">({column.items.length})</span>
              </h2>
              {blocked && (
                <p className="flex items-center gap-1 text-xs text-fg-muted">
                  <Ban aria-hidden="true" className="size-3.5" />
                  Not allowed
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {column.items.map((item) => (
                  <li key={item.id}>
                    <article
                      ref={(element) => {
                        if (element === null) cards.current.delete(item.id);
                        else cards.current.set(item.id, element);
                      }}
                      tabIndex={item.id === tabStop ? 0 : -1}
                      draggable={item.can.edit}
                      aria-label={`${item.event.title}, ${whoOf(item)}, ${ENGAGEMENT_STATUS_LABELS[item.status]}`}
                      onFocus={() => {
                        setFocusedId(item.id);
                      }}
                      onKeyDown={(event) => {
                        onCardKey(event, item);
                      }}
                      onDragStart={() => {
                        setDragging(item);
                      }}
                      onDragEnd={() => {
                        setDragging(undefined);
                      }}
                      onDoubleClick={() => {
                        onOpen(item);
                      }}
                      className="flex cursor-grab flex-col gap-1 rounded-md border border-line bg-surface-raised p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          onOpen(item);
                        }}
                        className="text-left font-medium hover:underline"
                      >
                        {item.event.title}
                      </button>
                      <span className="text-fg-muted">{whoOf(item)}</span>
                      <span className="text-xs text-fg-muted">
                        {item.primaryMentor?.displayName ?? 'No primary mentor'}
                      </span>
                      <span className="text-xs">
                        <NextDeadline next={item.nextDeadline} now={now} />
                      </span>
                      <div className="flex justify-end">
                        <MoveMenu
                          ref={(handle) => {
                            if (handle === null) menus.current.delete(item.id);
                            else menus.current.set(item.id, handle);
                          }}
                          name={whoOf(item)}
                          status={item.status}
                          disabled={!item.can.edit}
                          onMove={(to) => {
                            refocus.current = item.id;
                            move(item, to);
                          }}
                        />
                      </div>
                      {errors[item.id] !== undefined && (
                        <p role="alert" className="flex items-start gap-1 text-xs text-danger">
                          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                          {errors[item.id]}
                        </p>
                      )}
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
