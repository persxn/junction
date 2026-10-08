import { OUTCOME_RESULT_LABELS, type OutcomeResult } from '@compintel/contracts';
import {
  Award,
  BadgeCheck,
  CircleDot,
  Flag,
  Medal,
  Trophy,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/** A result as icon + label (§16.3: never colour alone), WP-21. */

const ICONS: Readonly<Record<OutcomeResult, LucideIcon>> = {
  WINNER: Trophy,
  RUNNER_UP: Medal,
  FINALIST: Award,
  QUALIFIED: BadgeCheck,
  PARTICIPATED: Flag,
  DID_NOT_PARTICIPATE: XCircle,
  OTHER: CircleDot,
};

const TONES: Readonly<Record<OutcomeResult, string>> = {
  WINNER: 'text-warning',
  RUNNER_UP: 'text-info',
  FINALIST: 'text-accent',
  QUALIFIED: 'text-success',
  PARTICIPATED: 'text-fg-muted',
  DID_NOT_PARTICIPATE: 'text-fg-subtle',
  OTHER: 'text-fg-muted',
};

export function OutcomeBadge({
  result,
  rank,
}: {
  readonly result: OutcomeResult;
  readonly rank?: number | null;
}): React.JSX.Element {
  const Icon = ICONS[result];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon aria-hidden="true" className={`size-4 ${TONES[result]}`} />
      {OUTCOME_RESULT_LABELS[result]}
      {rank !== undefined && rank !== null && <span className="text-fg-muted"> · rank {rank}</span>}
    </span>
  );
}
