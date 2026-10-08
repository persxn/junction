import type { NextDeadline as NextDeadlineValue } from '@compintel/contracts';

import { DEADLINE_KIND_LABELS } from '../discover/detail/DeadlineTimeline.js';
import { formatDeadline } from '../discover/detail/values.js';
import { countdown } from '../discover/urgency.js';

/**
 * A competition's next date with §12's urgency — icon, words and colour, never
 * colour alone: "Registration · by 7 Oct · High urgency".
 */
export function NextDeadline({
  next,
  now,
}: {
  readonly next: NextDeadlineValue | null;
  readonly now: number;
}): React.JSX.Element {
  if (next === null) {
    return <span className="text-fg-muted">No dates ahead</span>;
  }
  const due = countdown(next.at, next.precision, now);
  const Icon = due.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${due.tone}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="text-fg">
        {DEADLINE_KIND_LABELS[next.kind]} · {formatDeadline(next.at, next.precision, now)}
      </span>
      <span className="sr-only"> ({due.levelLabel})</span>
    </span>
  );
}
