import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A modal dialog (§16.3's keyboard rules): Esc closes it, Tab stays inside it,
 * focus starts on its first field and returns to whatever opened it. One
 * component, so every M2 dialog behaves the same way.
 */

export interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** `max-w-*` class; defaults to a form-sized dialog. */
  readonly width?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  width = 'max-w-md',
}: DialogProps): React.JSX.Element {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  // A ref, so a parent re-render (every keystroke in a field) does not re-run
  // the effect below and pull focus back to the first field.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || box.current === null) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const head = items[0];
      const tail = items.at(-1);
      if (head === undefined || tail === undefined) return;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-full w-full ${width} flex-col gap-4 overflow-auto rounded-lg border border-line bg-surface-raised p-6 shadow-[var(--ci-shadow-popover)]`}
      >
        <h2 id={titleId} className="text-md">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
