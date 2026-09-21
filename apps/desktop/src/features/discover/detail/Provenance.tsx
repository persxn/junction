import type { ClaimGroup } from '@compintel/contracts';
import { selectionReasonText } from '@compintel/contracts';
import { Info } from 'lucide-react';
import { useId, useState } from 'react';

import { ago } from '../../../lib/ago.js';
import { formatClaimValue } from './values.js';

export interface ProvenanceProps {
  readonly group: ClaimGroup;
  readonly now: number;
}

/**
 * "as stated by Devfolio, verified 2 h ago" (§16.2), as a disclosure rather
 * than a hover tooltip.
 *
 * §16.3 asks for a full keyboard path, and a `title=` attribute has none: it
 * cannot be focused, it cannot be read by a screen reader reliably, and it
 * disappears the moment the pointer moves. So the marker is a real button with
 * `aria-expanded`, and what it opens is the same panel for a mouse and for a
 * keyboard. That panel names every source that stated the field, which makes it
 * useful even on a field with no disagreement.
 */
export function Provenance({ group, now }: ProvenanceProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const source = group.selectedSourceName;
  const summary =
    group.selectedReason === 'OVERRIDE'
      ? 'as corrected by hand'
      : `as stated by ${source ?? 'a source'}${
          group.verifiedAt === null ? '' : `, verified ${ago(group.verifiedAt, now)}`
        }`;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
        data-testid={`provenance-${group.field}`}
        className="inline-flex items-center gap-1 rounded-sm text-xs text-fg-muted hover:text-accent hover:underline"
      >
        <Info aria-hidden="true" className="size-3" />
        {summary}
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className="absolute top-full left-0 z-30 mt-1 w-72 rounded-lg border border-line bg-surface-raised p-2 text-xs shadow-[var(--ci-shadow-popover)]"
        >
          <span className="mb-1 block font-medium">{group.label}</span>
          <span className="mb-1 block text-fg-muted">
            {selectionReasonText(group.selectedReason, source)}
          </span>
          <ul className="flex flex-col gap-1">
            {group.claims.map((claim) => (
              <li key={claim.id} className={claim.isSelected ? 'font-medium' : 'text-fg-muted'}>
                {formatClaimValue(group.field, claim.value, now)} — {claim.sourceName},{' '}
                {ago(claim.observedAt, now)}
                {claim.isSelected ? ' (selected)' : ''}
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}
