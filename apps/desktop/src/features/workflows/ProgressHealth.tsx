import type { CompetitionListItem } from '@compintel/contracts';

import { HealthBadge } from './labels.js';

/**
 * A competition's progress and schedule health in one line, for the board's
 * cards and the list (WP-20a, R99). The reason is in the tooltip and the
 * accessible name; a closed competition shows its status instead, so nothing.
 */
export function ProgressHealth({
  item,
}: {
  readonly item: Pick<CompetitionListItem, 'progress' | 'health' | 'healthReason'>;
}): React.JSX.Element | null {
  if (item.progress === null && item.health === null) return null;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 text-xs"
      title={item.healthReason ?? undefined}
    >
      {item.progress !== null && <span>{Math.round(item.progress)}% done</span>}
      {item.health !== null && <HealthBadge health={item.health} />}
      {item.healthReason !== null && <span className="sr-only">{item.healthReason}</span>}
    </span>
  );
}
