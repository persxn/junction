import {
  ENGAGEMENT_STATUS_LABELS,
  type EngagementStatus,
  type ParticipantKind,
} from '@compintel/contracts';
import {
  Ban,
  CircleCheckBig,
  CircleDot,
  Flag,
  Lightbulb,
  Send,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/** Competition words and marks (§16.3: icon + label, never colour alone). */

const STATUS_ICONS: Readonly<Record<EngagementStatus, LucideIcon>> = {
  CONSIDERING: Lightbulb,
  ASSIGNED: UserCheck,
  APPLIED: Send,
  PARTICIPATING: Flag,
  COMPLETED: CircleCheckBig,
  WITHDRAWN: XCircle,
  NOT_SELECTED: Ban,
};

const STATUS_TONES: Readonly<Record<EngagementStatus, string>> = {
  CONSIDERING: 'text-fg-subtle',
  ASSIGNED: 'text-info',
  APPLIED: 'text-accent',
  PARTICIPATING: 'text-warning',
  COMPLETED: 'text-success',
  WITHDRAWN: 'text-fg-subtle',
  NOT_SELECTED: 'text-fg-subtle',
};

export const statusIcon = (status: EngagementStatus): LucideIcon => STATUS_ICONS[status];

export function CompetitionStatus({
  status,
}: {
  readonly status: EngagementStatus;
}): React.JSX.Element {
  const Icon = STATUS_ICONS[status] ?? CircleDot;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon aria-hidden="true" className={`size-4 ${STATUS_TONES[status]}`} />
      {ENGAGEMENT_STATUS_LABELS[status]}
    </span>
  );
}

export const KIND_LABELS: Readonly<Record<ParticipantKind, string>> = {
  TEAM: 'Team',
  INDIVIDUAL: 'Individual',
};
