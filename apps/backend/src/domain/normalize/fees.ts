import type { CandidateFee } from '@compintel/contracts';

import type { WarningCollector } from './warnings.js';

/**
 * Registration fees (§7.3).
 *
 * The distinction that matters, and that a naive parser always gets wrong:
 * **free is a price, unknown is not.** A source that says "Free" has told us the
 * fee is zero, and "₹0" filters should find it. A source that says nothing has
 * told us nothing, and it must not be shown as free — a professor budgeting for
 * a team needs those two to look different.
 *
 * Currencies are **never converted** (§7.3). Two currencies in one string means
 * we do not know which applies, so the fee is unknown and both are kept as text.
 */

/** Symbols and codes a source might use, mapped to ISO 4217. */
const CURRENCY_BY_SYMBOL: Record<string, string> = {
  '₹': 'INR',
  'rs.': 'INR',
  rs: 'INR',
  inr: 'INR',
  $: 'USD',
  usd: 'USD',
  us$: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  '£': 'GBP',
  gbp: 'GBP',
  '¥': 'JPY',
  jpy: 'JPY',
};

/** Minor units per major unit. Every currency here happens to use 100. */
const MINOR_UNITS = 100;

/** "No fee" in the wordings sources actually use. */
const FREE_PATTERNS = [
  /\bfree\b/i,
  /\bno\s+(?:registration\s+)?(?:fee|cost|charge)s?\b/i,
  /\bfree\s+(?:of\s+charge|entry|to\s+enter)\b/i,
  /\bnil\b/i,
  /\bzero\s+(?:fee|cost)\b/i,
];

/** An amount with its currency marker, e.g. `₹500`, `Rs. 1,200`, `$10`, `10 USD`. */
const AMOUNT_PATTERN =
  /(₹|Rs\.?|INR|US\$|\$|USD|€|EUR|£|GBP|¥|JPY)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(₹|Rs\.?|INR|US\$|\$|USD|€|EUR|£|GBP|¥|JPY)\b/gi;

interface Amount {
  readonly minor: number;
  readonly currency: string;
}

/**
 * Indian digit grouping ("1,00,000") parses the same way once the commas go.
 *
 * The pattern above requires a leading digit for a reason worth keeping: an
 * earlier version accepted `[\d,]+`, so the comma in "students, ₹500" matched
 * as the amount and the fee came out as zero — a free event that costs ₹500.
 */
function toMinor(digits: string): number | undefined {
  const bare = digits.replace(/,/g, '');
  if (bare.length === 0) {
    return undefined;
  }
  const value = Number(bare);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value * MINOR_UNITS);
}

function currencyOf(marker: string): string | undefined {
  return CURRENCY_BY_SYMBOL[marker.toLowerCase().replace(/\.$/, '')];
}

/** Every currency amount in a string, in the order they appear. */
export function findAmounts(text: string): Amount[] {
  const found: Amount[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const marker = match[1] ?? match[4];
    const digits = match[2] ?? match[3];
    if (marker === undefined || digits === undefined) {
      continue;
    }
    const currency = currencyOf(marker);
    const minor = toMinor(digits);
    if (currency !== undefined && minor !== undefined) {
      found.push({ minor, currency });
    }
  }
  return found;
}

/**
 * Reads a fee from whatever the source said about money.
 *
 * Returns `undefined` when the text does not mention a fee at all, so "we did
 * not look" and "we looked and found nothing" stay distinguishable at the call
 * site. A string that mentions money but cannot be read produces a fee with
 * `known: false` and the text kept, because "there is a fee and it says
 * something we could not parse" is itself worth showing.
 */
export function parseFee(
  raw: string | undefined,
  warnings?: WarningCollector,
  field = 'fee',
): CandidateFee | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = raw.trim();
  if (text.length === 0) {
    return undefined;
  }

  const amounts = findAmounts(text);

  // "Free" wins over a stray amount only when no amount was actually found:
  // "Free for IIT students, ₹500 otherwise" is not free.
  if (amounts.length === 0 && FREE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { known: true, minor: 0, currency: 'INR', text, confidence: 0.9 };
  }

  // "₹0" and friends: an explicit zero is a known price.
  if (amounts.length === 1) {
    const only = amounts[0];
    if (only !== undefined) {
      return {
        known: true,
        minor: only.minor,
        currency: only.currency,
        text,
        confidence: only.minor === 0 ? 0.95 : 0.85,
      };
    }
  }

  const currencies = new Set(amounts.map((amount) => amount.currency));
  if (currencies.size > 1) {
    warnings?.add(
      'FEE_AMBIGUOUS_CURRENCY',
      `The fee is quoted in ${[...currencies].join(' and ')}; it is kept as text and never converted.`,
      field,
    );
    return { known: false, text, confidence: 0 };
  }

  if (amounts.length > 1) {
    // Several amounts in one currency — tiers, per-head versus per-team. The
    // cheapest is not "the fee", and neither is the first one.
    warnings?.add(
      'FEE_UNPARSEABLE',
      'Several fee amounts were listed; the wording is kept and no single figure was chosen.',
      field,
    );
    return { known: false, text, confidence: 0 };
  }

  if (FREE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { known: true, minor: 0, currency: 'INR', text, confidence: 0.9 };
  }

  warnings?.add('FEE_UNPARSEABLE', `Could not read a fee from "${text.slice(0, 60)}".`, field);
  return { known: false, text, confidence: 0 };
}

/**
 * A prize total, which follows the same rules but is stricter about tables: a
 * list of placings is text, not a sum. Adding them up would invent a "total
 * prize pool" no source stated.
 */
export function parsePrizeTotal(
  raw: string | undefined,
): { totalMinor: number; currency: string } | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const amounts = findAmounts(raw);
  const only = amounts.length === 1 ? amounts[0] : undefined;
  if (only === undefined) {
    return undefined;
  }
  return { totalMinor: only.minor, currency: only.currency };
}
