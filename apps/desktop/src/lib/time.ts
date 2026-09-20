/**
 * The small amount of date formatting WP-06 needs: "when was the data last
 * good", which §16.3 requires every error state to say.
 *
 * `Intl` covers it without a dependency. §4.2 fixes date-fns(-tz) for the real
 * date work — event dates in Asia/Kolkata, countdowns, deadline arithmetic — and
 * that arrives with the screens that have dates on them.
 */

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['second', 1_000],
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
];

/** "4 minutes ago", "just now", "in 2 hours". */
export function relativeTime(when: Date, now: Date = new Date()): string {
  const deltaMs = when.getTime() - now.getTime();
  if (Math.abs(deltaMs) < 45_000) {
    return 'just now';
  }
  let chosen: readonly [Intl.RelativeTimeFormatUnit, number] = UNITS[0] as [
    Intl.RelativeTimeFormatUnit,
    number,
  ];
  for (const unit of UNITS) {
    if (Math.abs(deltaMs) >= unit[1]) {
      chosen = unit;
    }
  }
  return RELATIVE.format(Math.round(deltaMs / chosen[1]), chosen[0]);
}

/** The absolute form, for tooltips and diagnostics where "ago" is not enough. */
export function absoluteTime(when: Date): string {
  return when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
