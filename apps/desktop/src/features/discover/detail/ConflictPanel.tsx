import type { DetailConflict } from '@compintel/contracts';
import { selectionReasonText } from '@compintel/contracts';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { ago } from '../../../lib/ago.js';
import { formatClaimValue } from './values.js';

export interface ConflictPanelProps {
  readonly conflicts: readonly DetailConflict[];
  readonly now: number;
}

/** The panel's stable handle for the tests, the E2E and a bug report. */
export const CONFLICT_PANEL_TESTID = 'sources-disagree';

/**
 * "Sources disagree" (§7.5, §16.2) — the §19 acceptance criterion for WP-16b.
 *
 * Every claimed value is here, with who said it and when, and the one the app
 * selected is marked **and** says why it won. Nothing is averaged, nothing is
 * merged and nothing is hidden: a professor about to trust a deadline can see
 * every deadline that was claimed and decide for themselves.
 *
 * The fields §7.5 calls material come first; the rest — a prize worded two ways,
 * a title spelled two ways — are listed under their own heading, because they
 * are worth showing and are not worth alarming anybody about.
 */
export function ConflictPanel({ conflicts, now }: ConflictPanelProps): React.JSX.Element | null {
  if (conflicts.length === 0) {
    return null;
  }
  const material = conflicts.filter((conflict) => conflict.material);
  const minor = conflicts.filter((conflict) => !conflict.material);

  return (
    <section
      data-testid={CONFLICT_PANEL_TESTID}
      aria-labelledby="drawer-conflicts"
      className="rounded-lg border border-warning bg-surface-sunken p-3"
    >
      <h3 id="drawer-conflicts" className="flex items-center gap-2 font-medium text-warning">
        <AlertTriangle aria-hidden="true" className="size-4" />
        Sources disagree
      </h3>
      <p className="mt-1 text-sm text-fg-muted">
        Junction never merges values that disagree. Every source&apos;s answer is below; the one the
        app shows is marked, with the reason it was chosen.
      </p>

      {material.map((conflict) => (
        <ConflictBlock key={conflict.field} conflict={conflict} now={now} />
      ))}

      {minor.length > 0 && (
        <>
          <h4 className="mt-3 flex items-center gap-2 text-sm font-medium text-fg-muted">
            <Info aria-hidden="true" className="size-3.5" />
            Minor differences
          </h4>
          {minor.map((conflict) => (
            <ConflictBlock key={conflict.field} conflict={conflict} now={now} />
          ))}
        </>
      )}
    </section>
  );
}

function ConflictBlock({
  conflict,
  now,
}: {
  conflict: DetailConflict;
  now: number;
}): React.JSX.Element {
  const selected = JSON.stringify(conflict.selected);
  // By source record, not by value: two sources can state the same thing and
  // still both lose to a third, and only one claim was actually selected.
  const isSelectedValue = (value: DetailConflict['values'][number]): boolean =>
    conflict.selectedSourceRecordId === null
      ? JSON.stringify(value.value) === selected
      : value.sourceRecordId === conflict.selectedSourceRecordId && !value.alternate;
  const anySelected = conflict.values.some(isSelectedValue);
  return (
    <div data-testid={`conflict-${conflict.field}`} className="mt-3">
      <h4 className="text-sm font-medium">{conflict.label}</h4>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {conflict.values.map((value) => {
          const isSelected = isSelectedValue(value);
          return (
            <li
              key={`${value.sourceRecordId}-${String(value.alternate)}`}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              {isSelected && (
                <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0 text-success" />
              )}
              <span className={isSelected ? 'font-medium' : ''}>
                {isSelected && <span className="sr-only">Shown by Junction: </span>}
                {formatClaimValue(conflict.field, value.value, now)}
              </span>
              <span className="text-fg-muted">
                — {value.sourceKey}, seen {ago(value.observedAt, now)}
                {value.alternate ? ' (also stated by the same source)' : ''}
              </span>
              {isSelected && (
                <span className="w-full text-xs text-fg-muted">
                  {selectionReasonText(conflict.selectedReason, conflict.selectedSourceName)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!anySelected && (
        <p className="mt-1 text-xs text-fg-muted">
          Junction shows {formatClaimValue(conflict.field, conflict.selected, now)} —{' '}
          {selectionReasonText(conflict.selectedReason, conflict.selectedSourceName)}.
        </p>
      )}
    </div>
  );
}
