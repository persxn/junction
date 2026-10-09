import { SEVERITY_LABELS, type Notification, type Severity } from '@compintel/contracts';
import { AlertOctagon, AlertTriangle, Info, type LucideIcon } from 'lucide-react';

import { dateText } from '../deadlines/deadline-model.js';

/**
 * The inbox's pure rules (WP-23, R111): snooze choices in Indian time, the
 * severity's icon and word, the due line with its precision, and which routes
 * a notification — or a toast — may open.
 */

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 09:00 IST on the Kolkata day that contains `instant`. */
export function nineAmIst(instant: number): number {
  return Date.parse(`${KEY.format(new Date(instant))}T09:00:00+05:30`);
}

export interface SnoozeChoice {
  readonly label: string;
  readonly until: number;
}

/** R111: 1 h · tomorrow 09:00 · the due day 09:00 (when it has one and it is ahead). */
export function snoozeChoices(now: number, dueAt: string | null): SnoozeChoice[] {
  const choices: SnoozeChoice[] = [
    { label: 'For 1 hour', until: now + HOUR },
    { label: 'Until tomorrow, 9:00', until: nineAmIst(now + DAY) },
  ];
  if (dueAt !== null) {
    const dueDay = nineAmIst(Date.parse(dueAt));
    if (dueDay > now && dueDay !== choices[1]!.until) {
      choices.push({ label: 'Until the due day, 9:00', until: dueDay });
    }
  }
  return choices;
}

/** A `datetime-local` value, read as Indian time; undefined if not in the future. */
export function chosenTime(value: string, now: number): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const at = Date.parse(`${value}:00+05:30`);
  return Number.isNaN(at) || at <= now ? undefined : at;
}

/** Same shape as the contract's toast route: one of our own paths, never a URL. */
export function isInternalRoute(route: unknown): route is string {
  return typeof route === 'string' && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(route);
}

export const SEVERITY_ICON: Readonly<Record<Severity, LucideIcon>> = {
  INFO: Info,
  WARNING: AlertTriangle,
  CRITICAL: AlertOctagon,
};

export const SEVERITY_TONE: Readonly<Record<Severity, string>> = {
  INFO: 'text-fg-muted',
  WARNING: 'text-warning',
  CRITICAL: 'text-danger',
};

export const severityText = (severity: Severity): string => SEVERITY_LABELS[severity];

/** "Due 27 Sep (time not stated)" — never a midnight the source did not say. */
export function dueLine(
  notification: Pick<Notification, 'dueAt' | 'precision'>,
): string | undefined {
  if (notification.dueAt === null || notification.precision === null) return undefined;
  if (notification.precision === 'UNKNOWN') return undefined;
  return `Due ${dateText({ dueAt: notification.dueAt, precision: notification.precision })}`;
}

/** "3 unread notifications", "1 unread notification", "No unread notifications". */
export function unreadLabel(count: number): string {
  if (count === 0) return 'No unread notifications';
  return `${String(count)} unread notification${count === 1 ? '' : 's'}`;
}

/** The badge's text: 1–9, then "9+". */
export const badgeText = (count: number): string => (count > 9 ? '9+' : String(count));
