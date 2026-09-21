import type { EventSourceDetail } from '@compintel/contracts';
import { Globe } from 'lucide-react';

import { ago } from '../../../lib/ago.js';
import { sourceName } from '../labels.js';

export interface SourcesListProps {
  readonly sources: readonly EventSourceDetail[];
  readonly now: number;
}

/**
 * The sources list (§16.2) with D-32's attribution on every one.
 *
 * Attribution is not decoration and not a footnote: CTFtime and CLIST are read
 * on terms that ask for credit, and the place an event's data is shown is the
 * place the credit belongs. A source with no attribution text simply has none —
 * nothing is invented to fill the line.
 */
export function SourcesList({ sources, now }: SourcesListProps): React.JSX.Element {
  return (
    <section aria-labelledby="drawer-sources">
      <h3 id="drawer-sources" className="mb-2 text-sm font-medium text-fg-muted">
        Sources
      </h3>
      <ul data-testid="sources-list" className="flex flex-col gap-2 text-sm">
        {sources.map((source) => (
          <li key={source.key} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <Globe aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
              <span className="font-medium">{sourceName(source.key)}</span>
              <span className="text-xs text-fg-muted">
                last read {ago(source.lastFetchedAt, now)}
              </span>
            </span>
            {source.attributionText !== null && (
              <span className="pl-5 text-xs text-fg-muted">{source.attributionText}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
