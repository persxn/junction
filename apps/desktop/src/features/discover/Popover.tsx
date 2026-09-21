import { useEffect, useId, useRef, useState } from 'react';

export interface PopoverProps {
  /** The trigger's content. */
  readonly trigger: React.ReactNode;
  /** The trigger's accessible name. */
  readonly label: string;
  readonly active: boolean;
  readonly children: React.ReactNode;
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

  return (
    <div ref={root} className="relative">
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
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // The drawer and the palette also listen for Esc; this one is closing first.
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
          className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-line bg-surface-raised p-3 shadow-[var(--ci-shadow-popover)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
