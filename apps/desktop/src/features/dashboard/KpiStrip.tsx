import type { KpiScope } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { getKpis } from '../../api/deadlines.js';
import { Skeleton } from '../../components/Skeleton.js';
import { formatCount } from '../../lib/count.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';

/**
 * The KPI strip (§16.2, R107, WP-22): four tiles, each a link to the list it
 * counts, with exactly that list's filter; the number uses the list header's
 * own formatter, so an approximate total reads the same in both places.
 */
export function KpiStrip({ scope }: { readonly scope: KpiScope }): React.JSX.Element {
  const connection = useBackendConnection();
  const kpis = useQuery({
    queryKey: ['dashboard', 'kpis', scope],
    queryFn: () => getKpis(connection, scope),
  });
  if (kpis.isPending) return <Skeleton lines={2} label="Loading the numbers" />;
  if (kpis.isError) {
    return (
      <p
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md bg-danger-surface p-3 text-sm"
      >
        The numbers did not load: {problemText(kpis.error)}
        <button
          type="button"
          onClick={() => void kpis.refetch()}
          className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-surface-hover"
        >
          Try again
        </button>
      </p>
    );
  }
  return (
    <ul aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.data.tiles.map((tile) => (
        <li key={tile.key}>
          <Link
            to={tile.link.to}
            search={tile.link.search as never}
            className="flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-3 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="font-display text-2xl" data-testid={`kpi-${tile.key}`}>
              {formatCount(tile.value, tile.totalIsApproximate)}
            </span>
            <span className="text-sm text-fg-muted">{tile.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
