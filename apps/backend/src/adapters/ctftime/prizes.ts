import type { CandidateAlternateClaim, CandidatePrize } from '@compintel/contracts';

import { findAmounts, redact } from '../../domain/normalize/index.js';

/**
 * CTFtime's two statements about money, kept apart (§7.3, R63). Pure.
 *
 * `prizes` is the structured field and the candidate's value. The description
 * is prose written by the same organizer, and the two disagree often enough to
 * be recorded in WP-02's findings — "$500" in `prizes`, "₹50,000" in the
 * description. Neither is converted into the other and neither is dropped: the
 * description's figures ride along as an alternate claim.
 */

/** Words that make a lone figure a *total* rather than one line of a table. */
const TOTAL_WORDS = /\b(?:total|pool)\b/i;

/** A short `prizes` value is the figure itself ("$1,000"), not a sentence around one. */
const SHORT_PRIZE_TEXT = 40;

/** A description line that talks about prizes rather than, say, a fee. */
const PRIZE_CONTEXT = /\b(?:prizes?|rewards?|pool|winners?|place|\d+(?:st|nd|rd|th))\b/i;

/**
 * `prizes` → the candidate's prize.
 *
 * A numeric total is read only from one unambiguous figure that is plainly the
 * total: the only amount in the text, in a currency we know, and either
 * described as a total/pool or standing nearly alone. "2 BTC" is not a currency
 * `findAmounts` knows, so it stays text; "a ticket valued at USD 400" is one
 * figure but not a prize total, so it stays text too; a placings table is text
 * because adding it up would invent a number nobody stated.
 */
export function prizeFromText(prizes: string): CandidatePrize | undefined {
  const text = prizes.trim();
  if (text.length === 0) {
    return undefined;
  }
  const amounts = findAmounts(text);
  const only = amounts.length === 1 ? amounts[0] : undefined;
  const isTotal = TOTAL_WORDS.test(text) || text.length <= SHORT_PRIZE_TEXT;
  if (only === undefined || !isTotal) {
    return { text };
  }
  return { text, totalMinor: only.minor, currency: only.currency };
}

/** `currency:minor` for every amount, sorted, so two statements can be compared as sets. */
function figures(text: string): string {
  return findAmounts(text)
    .map((amount) => `${amount.currency}:${String(amount.minor)}`)
    .sort()
    .join('|');
}

/**
 * The description's prize lines, when they state figures the `prizes` field
 * does not. At most one claim: the lines are kept together, verbatim and
 * redacted, because splitting "1st — ₹50,000 / 2nd — ₹30,000" into three claims
 * would present one statement as three.
 *
 * Nothing is claimed when `prizes` is empty — there is then no second
 * statement, only a description, and the description is stored whole anyway.
 */
export function prizeClaims(prizes: string, description: string): CandidateAlternateClaim[] {
  if (prizes.trim().length === 0) {
    return [];
  }
  const lines = description.split(/\r?\n/);
  const prizeLines: string[] = [];
  let underPrizeHeading = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      underPrizeHeading = false;
      continue;
    }
    const hasAmount = findAmounts(line).length > 0;
    if (hasAmount && (underPrizeHeading || PRIZE_CONTEXT.test(line))) {
      prizeLines.push(line);
    }
    if (!hasAmount && /\bprizes?\b/i.test(line)) {
      underPrizeHeading = true;
    }
  }
  if (prizeLines.length === 0) {
    return [];
  }
  const stated = prizeLines.join('\n');
  if (figures(stated) === figures(prizes)) {
    return [];
  }
  const text = redact(stated);
  const currencies = [...new Set(findAmounts(stated).map((amount) => amount.currency))];
  const structured = [...new Set(findAmounts(prizes).map((amount) => amount.currency))];
  return [
    {
      field: 'prizeText',
      value: text,
      sourceText: text,
      note:
        `The description states prize figures (${currencies.join(', ')}) that differ from the ` +
        `structured prizes field${structured.length === 0 ? '' : ` (${structured.join(', ')})`}; ` +
        'the structured field is used and nothing was converted.',
    },
  ];
}
