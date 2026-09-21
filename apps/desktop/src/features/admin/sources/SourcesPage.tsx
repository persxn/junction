import type { SourceSummary } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';

import { listSources } from '../../../api/admin-sources.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { SessionCard } from './SessionCard.js';

/**
 * Admin → Sources (§16.2, §10.2 `source.manage`).
 *
 * WP-14 builds the part R74 needs: which sources the professor has signed in
 * to, and the three things they can do about it. The table of run history,
 * freshness and "Run now" that §16.2 describes belongs to WP-30's health work
 * and is not here yet — this screen says so rather than showing an empty table
 * that looks broken.
 */

export function SourcesPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const sources = useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: async () => listSources(connection),
  });

  const rows: readonly SourceSummary[] = sources.data ?? [];
  const scraped = rows.filter(
    (source) => source.adapter !== 'MANUAL' && source.adapter !== 'URL_IMPORT',
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg">Sources &amp; scraper</h1>
        <p className="text-fg-muted">
          Where events come from. Sign in to the sources that show you more when you are signed in —
          with your own account, read-only.
        </p>
      </header>

      {sources.isPending && <Skeleton lines={4} label="Loading the list of sources" />}

      {sources.isError && (
        <p role="alert" className="rounded-lg border border-danger bg-danger-subtle px-4 py-3">
          The list of sources could not be read.
        </p>
      )}

      <section className="flex flex-col gap-4" aria-label="Sources">
        {scraped.map((source) => (
          <SessionCard key={source.key} source={source} />
        ))}
      </section>

      <p className="flex items-center gap-2 text-fg-subtle">
        <Radio aria-hidden="true" className="size-4" />
        Run history, freshness and “Run now” arrive with the system-health screen.
      </p>
    </main>
  );
}
