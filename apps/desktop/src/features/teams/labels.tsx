import {
  COVERAGE_STATE_HINTS,
  COVERAGE_STATE_LABELS,
  COVERAGE_STATES,
  TEAM_STATUS_LABELS,
  type CoverageChip,
  type CoverageState,
  type TeamStatus,
} from '@compintel/contracts';
import {
  Archive,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  Crown,
  type LucideIcon,
} from 'lucide-react';

/** Team words and marks (§16.3: icon + label, never colour alone). */

const STATUS_ICONS: Readonly<Record<TeamStatus, LucideIcon>> = {
  ACTIVE: CirclePlay,
  ARCHIVED: Archive,
};

export function TeamStatusBadge({ status }: { readonly status: TeamStatus }): React.JSX.Element {
  const Icon = STATUS_ICONS[status];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon
        aria-hidden="true"
        className={`size-4 ${status === 'ACTIVE' ? 'text-success' : 'text-fg-subtle'}`}
      />
      {TEAM_STATUS_LABELS[status]}
    </span>
  );
}

export function LeadBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-surface px-2 py-0.5 text-xs font-medium">
      <Crown aria-hidden="true" className="size-3" />
      Lead
    </span>
  );
}

const COVERAGE_ICONS: Readonly<Record<CoverageState, LucideIcon>> = {
  COVERED: CircleCheck,
  THIN: CircleDashed,
  MISSING: CircleAlert,
};

const COVERAGE_TONES: Readonly<Record<CoverageState, string>> = {
  COVERED: 'border-success text-fg',
  THIN: 'border-warning text-fg',
  MISSING: 'border-danger border-dashed text-fg',
};

const ICON_TONES: Readonly<Record<CoverageState, string>> = {
  COVERED: 'text-success',
  THIN: 'text-warning',
  MISSING: 'text-danger',
};

export function CoverageChips({
  chips,
}: {
  readonly chips: readonly CoverageChip[];
}): React.JSX.Element {
  if (chips.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No skills to show yet: add members with skills, or set the skills this team needs.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Skill coverage">
      {chips.map((chip) => {
        const Icon = COVERAGE_ICONS[chip.state];
        return (
          <li
            key={chip.name}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm ${COVERAGE_TONES[chip.state]}`}
          >
            <Icon aria-hidden="true" className={`size-3.5 ${ICON_TONES[chip.state]}`} />
            <span>{chip.name}</span>
            <span className="text-fg-muted">
              · {COVERAGE_STATE_LABELS[chip.state]}
              {chip.holders > 0 && ` (${String(chip.holders)})`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function CoverageLegend(): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-fg-muted">
      {COVERAGE_STATES.map((state) => {
        const Icon = COVERAGE_ICONS[state];
        return (
          <div key={state} className="contents">
            <dt className="inline-flex items-center gap-1 font-medium text-fg">
              <Icon aria-hidden="true" className={`size-3.5 ${ICON_TONES[state]}`} />
              {COVERAGE_STATE_LABELS[state]}
            </dt>
            <dd>{COVERAGE_STATE_HINTS[state]}</dd>
          </div>
        );
      })}
    </dl>
  );
}
