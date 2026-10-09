import { useEffect, useId, useRef, useState } from 'react';

export interface PopoverProps {
  /** The trigger's content. */
  readonly trigger: React.ReactNode;
  /** The trigger's accessible name. */
  readonly label: string;
  readonly active: boolean;
  /** Content, or a function of `close` for content that finishes the job (WP-24's menu). */
  readonly children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Panel width; a chip editor's by default. */
  readonly width?: string;
  /** Test seam and "open with the page" state. */
  readonly defaultOpen?: boolean;
}

/**
 * A non-modal popover for one filter chip. The trigger says whether it is
 * open (`aria-expanded`); Esc or a click outside closes it and puts focus back
 * on the trigger, so a keyboard user never loses their place in the chip bar.
 */
export function Popover({
  trigger,
  label,
  active,
  children,
  width = 'w-72',
  defaultOpen = false,
}: PopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  // When the panel closes with focus inside it (a menu item finished the job),
  // focus would fall to the page; it goes back to the trigger instead. An
  // outside click has already put focus where the person clicked.
  const wasOpen = useRef(open);
  useEffect(() => {
    const active = document.activeElement;
    if (wasOpen.current && !open && (active === null || active === document.body)) {
      button.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  return (
    // Esc closes from the trigger as well as from inside the panel (WP-24's
    // menu can open with nothing focusable in it).
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // The drawer and the palette also listen for Esc; this one is closing first.
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm ${
          active
            ? 'border-accent bg-accent-surface text-accent'
            : 'border-line hover:bg-surface-hover'
        }`}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`absolute left-0 z-30 mt-1 ${width} rounded-lg border border-line bg-surface-raised p-3 shadow-[var(--ci-shadow-popover)]`}
        >
          {typeof children === 'function'
            ? children(() => {
                setOpen(false);
              })
            : children}
        </div>
      )}
    </div>
  );
}
