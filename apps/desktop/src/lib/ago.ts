/**
 * "4 min ago", "2 h ago" — the compact form §16.1 and §16.2 ask for
 * ("Updated 4 min ago", "as stated by Devfolio, verified 2 h ago").
 *
 * `lib/time.ts`'s `relativeTime` writes it out in full ("4 minutes ago"), which
 * is right in a diagnostics panel and too long in a pill. Both read the clock
 * from their caller: every screen that shows one of these gets `now` from
 * `useNow()`, so nothing reads `Date.now()` during a render and a test can put
 * the clock wherever it likes.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function unit(ms: number): string {
  if (ms < HOUR) {
    return `${String(Math.max(1, Math.floor(ms / MINUTE)))} min`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${String(hours)} h`;
  }
  const days = Math.floor(ms / DAY);
  return `${String(days)} ${days === 1 ? 'day' : 'days'}`;
}

/** `at` relative to `now`: "just now", "4 min ago", "2 h ago", "in 3 days". */
export function ago(at: number, now: number): string {
  const delta = now - at;
  if (Math.abs(delta) < 45_000) {
    return 'just now';
  }
  return delta > 0 ? `${unit(delta)} ago` : `in ${unit(-delta)}`;
}

/** The same, for a value that may not exist: "never" reads better than an empty gap. */
export function agoOrNever(at: number | null, now: number, never = 'never'): string {
  return at === null ? never : ago(at, now);
}
