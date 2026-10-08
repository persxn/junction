import type { DeadlineKind, EventDeadline } from '@compintel/contracts';
import { CalendarClock, PenLine } from 'lucide-react';

import { formatDeadline } from './values.js';

export interface DeadlineTimelineProps {
  readonly deadlines: readonly EventDeadline[];
  readonly now: number;
}

export const DEADLINE_KIND_LABELS: Readonly<Record<DeadlineKind, string>> = {
  REGISTRATION: 'Registration',
  ABSTRACT: 'Abstract',
  IDEA_SUBMISSION: 'Idea submission',
  PPT: 'Presentation',
  PROTOTYPE: 'Prototype',
  FINAL_SUBMISSION: 'Final submission',
  ROUND: 'Round',
  RESULT: 'Result',
  OTHER: 'Other',
};

/**
 * The deadlines timeline (§16.2), in order and precision-aware.
 *
 * A source that stated a day and no time is shown as "by 27 Sep" — ADR-0015's
 * rule, and the reason it matters is that "27 Sep, 00:00" would move a
 * professor's deadline a whole day earlier than anybody said.
 */
export function DeadlineTimeline({
  deadlines,
  now,
}: DeadlineTimelineProps): React.JSX.Element | null {
  if (deadlines.length === 0) {
    return null;
  }
  const ordered = [...deadlines].sort((a, b) => a.dueAt - b.dueAt);

  return (
    <section aria-labelledby="drawer-deadlines">
      <h3 id="drawer-deadlines" className="mb-2 text-sm font-medium text-fg-muted">
        Deadlines
      </h3>
      <ol data-testid="deadline-timeline" className="flex flex-col gap-2 text-sm">
        {ordered.map((deadline) => (
          <li key={deadline.id} className="flex items-baseline gap-2">
            <CalendarClock aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
            <span className="font-medium">
              {deadline.label || DEADLINE_KIND_LABELS[deadline.kind]}
            </span>
            <span className="text-fg-muted">
              {formatDeadline(deadline.dueAt, deadline.precision, now)}
            </span>
            {deadline.origin === 'MANUAL' && (
              <span className="flex items-center gap-1 text-xs text-fg-muted">
                <PenLine aria-hidden="true" className="size-3" />
                Added by hand
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
