import { ChevronDown, ChevronRight, LifeBuoy } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { readLocal, writeLocal } from '../lib/storage.js';

/**
 * A screen's own guide (owner request, 2 Oct 2026: "include the guides in the
 * UI"). Every M2 screen opens with a short, collapsible explanation — what the
 * screen is for, how to use it, and what is not obvious — so a professor never
 * needs a manual beside the app.
 *
 * It starts open the first time and remembers being closed, per viewer and per
 * guide, in local storage (a convenience: if storage is unavailable it simply
 * starts open again). The toggle is a real button with `aria-expanded`, so the
 * guide is reachable and readable from the keyboard and by a screen reader.
 */

export interface GuideProps {
  /** Stable key, e.g. `students-list`; also the storage key. */
  readonly id: string;
  /** "How the student list works". */
  readonly title: string;
  readonly children: ReactNode;
}

const storageKey = (id: string): string => `ci.guide.${id}.closed`;

export function Guide({ id, title, children }: GuideProps): React.JSX.Element {
  const [open, setOpen] = useState(() => readLocal(storageKey(id)) !== '1');
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-line bg-surface-raised text-sm"
      data-guide={id}
    >
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            const next = !open;
            setOpen(next);
            writeLocal(storageKey(id), next ? '0' : '1');
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-medium hover:bg-surface-hover"
        >
          <LifeBuoy aria-hidden="true" className="size-4 text-accent" />
          <span className="flex-1">{title}</span>
          <Chevron aria-hidden="true" className="size-4 text-fg-subtle" />
          <span className="sr-only">{open ? 'Hide this guide' : 'Show this guide'}</span>
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="guide-body flex flex-col gap-2 px-3 pb-3 text-fg-muted">
          {children}
        </div>
      )}
    </section>
  );
}
