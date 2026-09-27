import type { EventSourceDetail } from '@compintel/contracts';
import { ExternalLink, Globe, PenLine } from 'lucide-react';

import { useToast } from '../../../components/toast/ToastProvider.js';
import { ago } from '../../../lib/ago.js';
import { openExternal } from '../../../lib/external.js';
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
 *
 * Each source's own page is a button rather than an `<a href>`, because §13 says
 * a link opens in the default browser and an anchor inside the WebView would
 * navigate the application window instead (ruling R78). A source with no page —
 * an event somebody typed in — says so in words: the reserved `.invalid` URL is
 * dropped by the backend and never reaches a screen (M1 review fault 6).
 */
export function SourcesList({ sources, now }: SourcesListProps): React.JSX.Element {
  const toast = useToast();

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
            {source.url === null ? (
              <span className="flex items-center gap-1 pl-5 text-xs text-fg-muted">
                <PenLine aria-hidden="true" className="size-3" />
                Entered by hand
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const url = source.url;
                  if (url === null) return;
                  void openExternal(url).then((opened) => {
                    if (!opened) {
                      toast.show({
                        tone: 'warning',
                        title: 'Could not open the link here',
                        description: `Copy it instead: ${url}`,
                      });
                    }
                  });
                }}
                className="ml-5 flex w-fit items-center gap-1 rounded-sm text-xs text-fg-muted hover:text-accent hover:underline"
              >
                <ExternalLink aria-hidden="true" className="size-3" />
                Open on {sourceName(source.key)}
              </button>
            )}
            {source.attributionText !== null && (
              <span className="pl-5 text-xs text-fg-muted">{source.attributionText}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
