import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * A stage's or task's "More actions" menu (WP-20a step 7): Move up, Move down,
 * Remove — the keyboard and pointer route to everything Alt+↑/↓ does. ↓/↑
 * move, Enter chooses, Esc closes and gives focus back (WP-19's MoveMenu
 * rules).
 */

export interface MenuItem {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

export function ItemMenu({
  name,
  items,
}: {
  /** Whose actions: "Actions for Build prototype". */
  readonly name: string;
  readonly items: readonly MenuItem[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const onKey = (event: React.KeyboardEvent): void => {
    const all = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ].filter((item) => !item.disabled);
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (to: number): void => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
    event.stopPropagation();
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${name}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="rounded-md p-1 hover:bg-surface-hover"
      >
        <EllipsisVertical aria-hidden="true" className="size-4" />
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${name}`}
          onKeyDown={onKey}
          className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          {items.map((item) => (
            <li role="none" key={item.label}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus:bg-accent-surface disabled:opacity-50"
              >
                <item.icon aria-hidden="true" className="size-4" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
