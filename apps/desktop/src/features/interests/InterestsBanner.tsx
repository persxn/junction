import { Sparkles } from 'lucide-react';
import { useState } from 'react';

import { InterestsDialog } from './InterestsDialog.js';
import { hasInterests, useInterests } from './use-interests.js';

/**
 * "Pick your interests to sharpen these" over Recommended (WP-24 step 8), on
 * Discover and the Dashboard, for someone with no interests yet. The list
 * still shows beneath it, ranked by deadline and trust, each card with its
 * reasons. Nothing shows while interests load or if they cannot be read.
 */
export function InterestsBanner({ compact = false }: { readonly compact?: boolean }) {
  const interests = useInterests();
  const [open, setOpen] = useState(false);
  if (interests.view === undefined || hasInterests(interests.view)) {
    return open ? (
      <InterestsDialog
        onClose={() => {
          setOpen(false);
        }}
      />
    ) : null;
  }
  return (
    <>
      <div
        className={`flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-raised text-sm ${compact ? 'p-2' : 'p-3'}`}
      >
        <Sparkles aria-hidden="true" className="size-4 text-accent" />
        <p className="flex-1">
          Pick your interests to sharpen these
          {compact
            ? ''
            : ' — until then they are ranked by deadline and how trusted the source is.'}
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Pick your interests
        </button>
      </div>
      {open && (
        <InterestsDialog
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
