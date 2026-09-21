import {
  AlarmClock,
  CalendarCheck,
  CalendarX,
  CircleHelp,
  Clock,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react';

import { daysBetween, formatDate } from './format.js';
import type { DatePrecision } from '@compintel/contracts';

/**
 * A registration countdown with its urgency (§12, §16.3). Every level is an
 * icon **and** a label **and** a colour — never colour alone:
 *
 *   Critical "Closes today" · High ≤ 3 days · Medium ≤ 7 days · Normal.
 *
 * Plus the two states a countdown can also be in: closed, and not announced.
 * Days are whole days in the display zone, so "today" means the professor's
 * today, not 24 hours from now.
 */

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'normal' | 'closed' | 'unknown';

export interface Countdown {
  readonly level: UrgencyLevel;
  /** What the card says: "Closes today", "Closes in 2 days", "Closes 22 Oct". */
  readonly label: string;
  /** The level in words, for the accessible name ("Critical", "Closed"). */
  readonly levelLabel: string;
  readonly icon: LucideIcon;
  /** A Tailwind text colour class from the urgency tokens. */
  readonly tone: string;
}

const LEVELS: Readonly<
  Record<UrgencyLevel, { levelLabel: string; icon: LucideIcon; tone: string }>
> = {
  critical: { levelLabel: 'Critical', icon: OctagonAlert, tone: 'text-urgency-critical' },
  high: { levelLabel: 'High urgency', icon: AlarmClock, tone: 'text-urgency-high' },
  medium: { levelLabel: 'Medium urgency', icon: Clock, tone: 'text-urgency-medium' },
  normal: { levelLabel: 'Open', icon: CalendarCheck, tone: 'text-urgency-low' },
  closed: { levelLabel: 'Closed', icon: CalendarX, tone: 'text-urgency-none' },
  unknown: { levelLabel: 'Unknown', icon: CircleHelp, tone: 'text-urgency-none' },
};

export function countdown(
  deadline: number | null,
  precision: DatePrecision,
  now: number,
): Countdown {
  const make = (level: UrgencyLevel, label: string): Countdown => ({
    level,
    label,
    ...LEVELS[level],
  });
  if (deadline === null) return make('unknown', 'Deadline not announced');
  if (deadline < now)
    return make('closed', `Registration closed ${formatDate(deadline, precision, now)}`);
  const days = daysBetween(now, deadline);
  if (days <= 0) return make('critical', 'Closes today');
  const inDays = days === 1 ? 'Closes tomorrow' : `Closes in ${String(days)} days`;
  if (days <= 3) return make('high', inDays);
  if (days <= 7) return make('medium', inDays);
  return make('normal', `Closes ${formatDate(deadline, precision, now)}`);
}
