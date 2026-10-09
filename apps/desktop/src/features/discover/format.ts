import type { DatePrecision, EventMode, PrizeSummary } from '@compintel/contracts';

/**
 * How a card says things (§16.2). Dates are read in Asia/Kolkata, the display
 * zone every query uses (A7); the formatters are built once, because building an
 * `Intl.DateTimeFormat` costs more than using one.
 */

export const DISPLAY_ZONE = 'Asia/Kolkata';
export const DAY_MS = 86_400_000;

const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fixed, not `Intl`: ICU's en-GB says "Sept", and the backend's reasons say "Sep". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` of an instant in the display zone. */
export function dayKey(at: number): string {
  return DAY_KEY.format(new Date(at));
}

/** Whole local days from `now`'s day to `at`'s day (0 = the same day). */
export function daysBetween(now: number, at: number): number {
  const utc = (key: string): number => Date.parse(`${key}T00:00:00Z`);
  return Math.round((utc(dayKey(at)) - utc(dayKey(now))) / DAY_MS);
}

/** "27 Sep 2026" for an ISO day — the concrete date a chip shows (A7). */
export function formatIsoDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return iso;
  return `${String(day)} ${MONTHS[month - 1] ?? ''} ${String(year)}`;
}

/** "27 Sep" in the current year, "27 Sep 2027" otherwise, "Sep 2026" for a month. */
export function formatDate(at: number, precision: DatePrecision, now: number): string {
  const [year, month, day] = dayKey(at).split('-').map(Number) as [number, number, number];
  const name = MONTHS[month - 1] ?? '';
  if (precision === 'MONTH') return `${name} ${String(year)}`;
  const thisYear = Number(dayKey(now).slice(0, 4));
  return `${String(day)} ${name}${year === thisYear ? '' : ` ${String(year)}`}`;
}

/** D-06's wording: "~180 km (straight line)". */
export function formatDistance(km: number | null, mode: EventMode): string {
  if (mode === 'ONLINE') return 'Online';
  if (km === null) return 'Distance unknown';
  if (km < 1) return '< 1 km (straight line)';
  return `~${String(Math.round(km))} km (straight line)`;
}

export function formatPrize(prize: PrizeSummary): string | undefined {
  if (prize.totalMinor !== null && prize.currency !== null) {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: prize.currency,
        maximumFractionDigits: 0,
      }).format(prize.totalMinor / 100);
    } catch {
      return `${prize.currency} ${String(Math.round(prize.totalMinor / 100))}`;
    }
  }
  return prize.text ?? undefined;
}

export function formatTeam(min: number | null, max: number | null): string | undefined {
  if (min === null && max === null) return undefined;
  if (min !== null && max !== null)
    return min === max ? `Team of ${String(min)}` : `Team ${String(min)}–${String(max)}`;
  if (max !== null) return `Team up to ${String(max)}`;
  return `Team ${String(min)}+`;
}

/** Monday (display zone) of the week an instant falls in, as `YYYY-MM-DD` — the Contest Calendar's groups. */
export function weekOf(at: number): string {
  const key = dayKey(at);
  const date = new Date(`${key}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The reasons a card states inline (WP-24): the two that added the most to its
 * score, ties in the server's order. WP-15b lists reasons in the order they
 * fire, so "the first two" could hide "AI/ML matches your interests" (20 points)
 * behind "Registration open" (10). Every reason stays under "Why relevant?".
 */
export function inlineReasons<T extends { readonly weightApplied: number }>(
  reasons: readonly T[],
  count = 2,
): T[] {
  return reasons
    .map((reason, index) => ({ reason, index }))
    .sort((a, b) => b.reason.weightApplied - a.reason.weightApplied || a.index - b.index)
    .slice(0, count)
    .map((entry) => entry.reason);
}
