import type { Milestone } from '@compintel/contracts';
import { PartyPopper, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { readLocal, writeLocal } from '../../lib/storage.js';
import { useAppearance } from '../../theme/appearance-context.js';

/** Milestones this viewer has already been shown, on this machine. */
export const MILESTONES_SEEN_KEY = 'junction.milestones.seen';

export function readSeen(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readLocal(MILESTONES_SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: string): void {
  writeLocal(MILESTONES_SEEN_KEY, JSON.stringify([...readSeen(), id]));
}

const DATE = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

/**
 * One recorded milestone, acknowledged once (R69): at STANDARD and SHOWCASE
 * only, never blocking, dismissible, and never shown again once seen. It is
 * marked seen the moment it appears — leaving the screen is a dismissal too.
 */
export function MilestoneCelebration({
  milestones,
}: {
  readonly milestones: readonly Milestone[];
}): React.JSX.Element | null {
  const { effects } = useAppearance();
  const [current] = useState(() => {
    if (effects === 'CALM') return undefined;
    const seen = readSeen();
    return milestones.find((milestone) => !seen.has(milestone.id));
  });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (current !== undefined) markSeen(current.id);
  }, [current]);

  if (current === undefined || !open) return null;
  return (
    <aside
      aria-label="Milestone"
      className="ci-celebrate relative flex items-center gap-3 rounded-lg border border-line bg-accent-surface p-3"
    >
      <span aria-hidden="true" className="relative">
        <PartyPopper className="size-5 text-accent" />
        <span className="ci-celebrate-spark absolute -top-1 left-1 size-1.5 rounded-full bg-[var(--ci-fx-1)]" />
        <span className="ci-celebrate-spark absolute -top-2 left-3 size-1 rounded-full bg-[var(--ci-fx-3)] [animation-delay:120ms]" />
      </span>
      <p className="flex-1 text-sm">
        <span className="font-medium">{current.title}</span>{' '}
        <span className="text-fg-muted">— recorded {DATE.format(new Date(current.at))}.</span>
      </p>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
        }}
        aria-label="Dismiss"
        className="rounded-md p-1 text-fg-muted hover:bg-surface-hover"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </aside>
  );
}
