import type { AssignWarningCode } from '@compintel/contracts';
import {
  AlarmClock,
  Ban,
  CalendarClock,
  CalendarX,
  CircleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Skeleton } from '../../../components/Skeleton.js';
import { useNow } from '../../../lib/use-now.js';
import { formatDeadline } from '../../discover/detail/values.js';
import { StageDatesEditor } from '../../workflows/StageDatesEditor.js';
import type { StepProps } from './assign-model.js';
import { useAssignPreview } from './use-assign-preview.js';

/**
 * Step "Review dates" (R98): the event's key dates in words with their
 * precision kept ("by 7 Oct", never "00:00"), the warnings — which never
 * block — and the A14 conflicts, which do, each naming the other competition.
 * WP-20a adds the workflow's stage dates, each editable.
 */

const WARNING_ICONS: Readonly<Record<AssignWarningCode, LucideIcon>> = {
  REGISTRATION_CLOSED: CalendarX,
  REGISTRATION_CLOSING: AlarmClock,
  EVENT_CANCELLED: Ban,
  EVENT_POSTPONED: CalendarClock,
  TEAM_TOO_SMALL: Users,
  TEAM_TOO_LARGE: Users,
};

export function ReviewStep({ draft, onChange }: StepProps): React.JSX.Element {
  const now = useNow();
  const error = useAssignPreview(draft, onChange);

  if (error !== undefined) {
    return (
      <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
        {error}
      </p>
    );
  }
  const preview = draft.preview;
  if (preview === undefined)
    return <Skeleton lines={4} label="Checking the dates and the roster" />;
  const event = preview.event;
  const at = now;
  const dates: [string, string][] = [
    [
      'Registration closes',
      event.registrationDeadlineAt === null
        ? 'Not announced'
        : formatDeadline(event.registrationDeadlineAt, event.registrationDeadlinePrecision, at),
    ],
    [
      'Starts',
      event.startsAt === null
        ? 'Not announced'
        : formatDeadline(event.startsAt, event.datePrecision, at),
    ],
  ];

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {dates.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-fg-subtle">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {preview.conflicts.length > 0 && (
        <section aria-labelledby="assign-conflicts" className="flex flex-col gap-1">
          <h3 id="assign-conflicts" className="flex items-center gap-1.5 font-medium text-danger">
            <CircleAlert aria-hidden="true" className="size-4" />
            This cannot be assigned yet
          </h3>
          <ul className="list-disc pl-5 text-sm">
            {preview.conflicts.map((conflict) => (
              <li key={conflict.studentId}>{conflict.message}</li>
            ))}
          </ul>
        </section>
      )}
      {preview.warnings.length > 0 && (
        <section aria-labelledby="assign-warnings" className="flex flex-col gap-1">
          <h3 id="assign-warnings" className="font-medium">
            Worth knowing
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {preview.warnings.map((warning) => {
              const Icon = WARNING_ICONS[warning.code];
              return (
                <li key={warning.code} className="flex items-start gap-1.5">
                  <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                  {warning.message}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {preview.conflicts.length === 0 && preview.warnings.length === 0 && (
        <p className="text-sm text-fg-muted">Nothing stands in the way.</p>
      )}
      {preview.competitions.some((planned) => planned.roster.length === 0) && (
        <p role="alert" className="text-sm text-danger">
          None of this team’s members is an active student, so there is nobody to take part.
        </p>
      )}
      <StageDatesEditor
        eventId={draft.eventId}
        draft={draft.workflow}
        onChange={(dueOverrides) => {
          onChange({ workflow: { ...draft.workflow, dueOverrides } });
        }}
      />
    </div>
  );
}
