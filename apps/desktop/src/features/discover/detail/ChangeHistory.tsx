import type { EventChangeDto } from '@compintel/contracts';
import { History, Loader2 } from 'lucide-react';

import { ago } from '../../../lib/ago.js';
import { formatClaimValue } from './values.js';

export interface ChangeHistoryProps {
  readonly items: readonly EventChangeDto[];
  readonly now: number;
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly onLoadOlder: () => void;
}

/**
 * The change history (§16.2, §6.2 `event_changes`), newest first.
 *
 * Every row is words: the field's label and the cause's label come from the
 * backend (`contracts/event-detail.ts`), so the screen never shows
 * `registrationDeadlineAt` or `SCRAPE`. This is the record a professor checks
 * when a deadline moved and they want to know who moved it and when.
 */
export function ChangeHistory({
  items,
  now,
  hasOlder,
  isLoadingOlder,
  onLoadOlder,
}: ChangeHistoryProps): React.JSX.Element {
  return (
    <section aria-labelledby="drawer-history">
      <h3
        id="drawer-history"
        className="mb-2 flex items-center gap-2 text-sm font-medium text-fg-muted"
      >
        <History aria-hidden="true" className="size-3.5" />
        Change history
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing has changed since this event was found.</p>
      ) : (
        <ol data-testid="change-history" className="flex flex-col gap-2 text-sm">
          {items.map((change) => (
            <li key={change.id} className="flex flex-col">
              <span>
                <span className="font-medium">{change.fieldLabel}</span>{' '}
                <span className="text-fg-muted">
                  {formatClaimValue(change.field, change.oldValue, now)} →{' '}
                </span>
                {formatClaimValue(change.field, change.newValue, now)}
              </span>
              <span className="text-xs text-fg-muted">
                {change.causeLabel} · {ago(change.detectedAt, now)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {hasOlder && (
        <button
          type="button"
          onClick={onLoadOlder}
          disabled={isLoadingOlder}
          className="mt-2 flex items-center gap-2 rounded-md border border-line px-3 py-1 text-sm hover:bg-surface-hover disabled:opacity-60"
        >
          {isLoadingOlder && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
          {isLoadingOlder ? 'Loading…' : 'Load older'}
        </button>
      )}
    </section>
  );
}
