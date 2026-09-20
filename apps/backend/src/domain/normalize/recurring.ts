/**
 * Recurring rated rounds (§7.3, D-08).
 *
 * Codeforces runs a rated round every few days and LeetCode two a week. Left
 * alone they would be most of the feed, and the feed is meant to be "things
 * worth putting a team on". D-08's answer is not to hide them but to move them:
 * `is_recurring_round` keeps them out of the main feed and in the Contest
 * Calendar, and `seriesHint` — the name with the round number stripped — is what
 * groups a year of them into one series.
 *
 * Stripping the number is the whole trick. "Codeforces Round 918 (Div. 2)" and
 * "Codeforces Round 919 (Div. 2)" have to produce the same hint, or every round
 * becomes its own series and nothing is grouped at all.
 */

export interface RecurringResult {
  readonly isRecurringRound: boolean;
  /** The series name with the round number removed; absent when not a round. */
  readonly seriesHint?: string;
}

/**
 * The shapes a recurring round's title takes. Each captures the series name and
 * leaves the number to be stripped.
 */
const ROUND_PATTERNS: readonly RegExp[] = [
  // "Codeforces Round 918 (Div. 2)", "Codeforces Round #918"
  /^(.*?\bround)\s*#?\s*\d+/i,
  // "Weekly Contest 377", "Biweekly Contest 120"
  /^((?:bi)?weekly\s+contest)\s*#?\s*\d+/i,
  // "CodeChef Starters 115"
  /^(.*?\bstarters)\s*#?\s*\d+/i,
  // "Educational Codeforces Round 160"
  /^(.*?\beducational\s+.*?\bround)\s*#?\s*\d+/i,
  // "Div. 2 Round 918", "Division 3 Contest 44"
  /^(.*?\bdiv(?:ision)?\.?\s*\d\b.*?(?:round|contest))\s*#?\s*\d+/i,
];

/** Trailing "(Div. 2)" and similar qualifiers; part of the series, kept. */
const TRAILING_NOISE = /[\s,–—-]+$/;

/**
 * Decides whether a title names one instalment of a recurring contest, and what
 * the series is called.
 */
export function detectRecurring(title: string): RecurringResult {
  const trimmed = title.trim();
  for (const pattern of ROUND_PATTERNS) {
    const match = pattern.exec(trimmed);
    const name = match?.[1]?.trim().replace(TRAILING_NOISE, '');
    if (name !== undefined && name.length > 0) {
      return { isRecurringRound: true, seriesHint: collapse(name) };
    }
  }
  // A bare "Div. 2" with no number is still a rated round, but there is no
  // number to strip, so the title itself is the series.
  if (/\bdiv(?:ision)?\.?\s*\d\b/i.test(trimmed) && /\b(?:round|contest)\b/i.test(trimmed)) {
    return { isRecurringRound: true, seriesHint: collapse(trimmed) };
  }
  return { isRecurringRound: false };
}

function collapse(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}
