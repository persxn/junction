import {
  SCHEDULE_HEALTH_LABELS,
  STAGE_STATUS_LABELS,
  type ScheduleHealth,
  type StageStatus,
} from '@compintel/contracts';
import {
  CalendarOff,
  CalendarX,
  Circle,
  CircleCheck,
  CircleCheckBig,
  CircleDashed,
  CircleDot,
  OctagonAlert,
  SkipForward,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

/** Workflow words and marks (§16.3: icon + label, never colour alone). */

const HEALTH_ICONS: Readonly<Record<ScheduleHealth, LucideIcon>> = {
  BLOCKED: OctagonAlert,
  OVERDUE: CalendarX,
  AT_RISK: TriangleAlert,
  ON_TRACK: CircleCheck,
  NO_DATES: CalendarOff,
};

const HEALTH_TONES: Readonly<Record<ScheduleHealth, string>> = {
  BLOCKED: 'text-danger',
  OVERDUE: 'text-danger',
  AT_RISK: 'text-warning',
  ON_TRACK: 'text-success',
  NO_DATES: 'text-fg-subtle',
};

export function HealthBadge({
  health,
  reason,
}: {
  readonly health: ScheduleHealth;
  readonly reason?: string | null;
}): React.JSX.Element {
  const Icon = HEALTH_ICONS[health];
  return (
    <span className="inline-flex items-start gap-1">
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${HEALTH_TONES[health]}`} />
      <span>
        <span className="font-medium">{SCHEDULE_HEALTH_LABELS[health]}</span>
        {reason !== undefined && reason !== null && (
          <span className="text-fg-muted"> — {reason}</span>
        )}
      </span>
    </span>
  );
}

const STAGE_ICONS: Readonly<Record<StageStatus, LucideIcon>> = {
  NOT_STARTED: Circle,
  IN_PROGRESS: CircleDot,
  BLOCKED: OctagonAlert,
  COMPLETED: CircleCheckBig,
  SKIPPED: SkipForward,
};

const STAGE_TONES: Readonly<Record<StageStatus, string>> = {
  NOT_STARTED: 'text-fg-subtle',
  IN_PROGRESS: 'text-info',
  BLOCKED: 'text-danger',
  COMPLETED: 'text-success',
  SKIPPED: 'text-fg-subtle',
};

export function StageStatusChip({ status }: { readonly status: StageStatus }): React.JSX.Element {
  const Icon = STAGE_ICONS[status] ?? CircleDashed;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs">
      <Icon aria-hidden="true" className={`size-3.5 ${STAGE_TONES[status]}`} />
      {STAGE_STATUS_LABELS[status]}
    </span>
  );
}
