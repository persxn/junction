import { ENGAGEMENT_STATUS_LABELS, type EngagementStatus } from '@compintel/contracts';
import { ArrowRightLeft } from 'lucide-react';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import { Dialog } from '../../components/Dialog.js';
import { moveLabel, moveTargets, needsConfirm } from './board-model.js';
import { statusIcon } from './labels.js';

/**
 * "Move to…" (WP-19 step 6): a menu button listing only the moves R97 allows
 * from this status, Withdraw and Not selected included. ↓/↑ move, Enter
 * chooses, Esc closes and gives focus back. A move into a final state asks
 * first; the parent performs the move.
 */

export interface MoveMenuHandle {
  readonly open: () => void;
}

export interface MoveMenuProps {
  readonly name: string;
  readonly status: EngagementStatus;
  readonly disabled?: boolean;
  readonly onMove: (to: EngagementStatus) => void;
}

export const MoveMenu = forwardRef<MoveMenuHandle, MoveMenuProps>(function MoveMenu(
  { name, status, disabled = false, onMove },
  handle,
) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<EngagementStatus | undefined>(undefined);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const targets = moveTargets(status);
  useImperativeHandle(handle, () => ({
    open: () => {
      if (!disabled && targets.length > 0) setOpen(true);
    },
  }));

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const choose = (to: EngagementStatus): void => {
    setOpen(false);
    if (needsConfirm(to)) setConfirming(to);
    else onMove(to);
  };

  const onKey = (event: React.KeyboardEvent): void => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const go = (to: number): void => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
    // Arrow keys and M belong to the menu while it is open, not to the board.
    event.stopPropagation();
  };

  if (targets.length === 0) return null;
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-keyshortcuts="M"
        aria-label={`Move ${name} to…`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
        className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs hover:bg-surface-hover disabled:opacity-50"
      >
        <ArrowRightLeft aria-hidden="true" className="size-3.5" />
        Move to…
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Move ${name} to`}
          onKeyDown={onKey}
          className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          {targets.map((to) => {
            const Icon = statusIcon(to);
            return (
              <li role="none" key={to}>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    choose(to);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus:bg-accent-surface"
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {moveLabel(to)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {confirming !== undefined && (
        <Dialog
          title={`${moveLabel(confirming)}?`}
          onClose={() => {
            setConfirming(undefined);
          }}
        >
          <p className="text-sm">
            {name} will be {ENGAGEMENT_STATUS_LABELS[confirming].toLowerCase()}. This is final: the
            competition cannot be moved or edited afterwards.
            {confirming !== 'COMPLETED' &&
              ' Its students are released and can join another competition for this event.'}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(undefined);
              }}
              className="rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const to = confirming;
                setConfirming(undefined);
                onMove(to);
              }}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
            >
              {moveLabel(confirming)}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
});
