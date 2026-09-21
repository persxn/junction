import type { SourceHealth } from '@compintel/contracts';
import { CircleCheck, CircleHelp, CircleSlash, TriangleAlert, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Each source state as an icon **and** a label (§16.3: never colour alone).
 *
 * The wording is §7.7's vocabulary, not a synonym of it: "Paused by policy" is
 * what the spec calls our own refusal to ask, and "Skipped, offline" is D-23's
 * "offline is not a failure" — which is why it is neither red nor called an
 * error anywhere on this screen.
 */
export interface HealthPresentation {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: string;
}

export const SOURCE_HEALTH: Readonly<Record<SourceHealth, HealthPresentation>> = {
  OK: { label: 'OK', icon: CircleCheck, tone: 'text-success' },
  FAILING: { label: 'Failing', icon: TriangleAlert, tone: 'text-warning' },
  PAUSED_BY_POLICY: { label: 'Paused by policy', icon: CircleSlash, tone: 'text-fg-muted' },
  OFFLINE: { label: 'Skipped, offline', icon: WifiOff, tone: 'text-fg-muted' },
  NEVER_RUN: { label: 'Not run yet', icon: CircleHelp, tone: 'text-fg-muted' },
};
