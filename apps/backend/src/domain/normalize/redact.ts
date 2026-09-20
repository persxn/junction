import type { WarningCollector } from './warnings.js';

/**
 * Contact-detail redaction (D-29, §7.3).
 *
 * The rule the spec sets is absolute: no personal contact details from a source
 * ever reach the database. `EventCandidate` has nowhere to put a person (R50),
 * which handles structured fields; this handles the other half, free text, where
 * an organizer's e-mail or a coordinator's mobile number routinely appears in
 * the middle of a description.
 *
 * Replacing rather than deleting matters. "Questions? Write to
 * [contact details on the source page]" tells a professor there *is* a contact
 * and where to find it, which is the useful half of what was removed. Deleting
 * would leave "Questions? Write to ." and look like a parsing bug.
 *
 * The bias is deliberately towards over-redaction of contact-shaped text and
 * **under**-redaction of numbers that are not phone numbers — a prize of
 * ₹1,00,000 or a year turned into a placeholder would be a worse bug than an
 * organizer's number surviving, because it corrupts data a professor relies on.
 * The negative cases are tested as carefully as the positive ones.
 */

export const REDACTED = '[contact details on the source page]';

/**
 * E-mail addresses. Deliberately broader than RFC 5322: a source writing
 * `team [at] example.com` is doing exactly what this is meant to catch.
 */
const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+\s*(?:@|\[\s*at\s*\]|\(\s*at\s*\))\s*[A-Za-z0-9.-]+\s*(?:\.|\[\s*dot\s*\])\s*[A-Za-z]{2,}/gi;

/**
 * Phone numbers, as §7.3 describes them: an optional `+91`-style country code
 * then digit groups separated by spaces or hyphens, **seven digits or more** in
 * total.
 *
 * Seven is the floor that keeps years (4), PIN codes (6) and small money amounts
 * out. The pattern requires either a leading `+`, or a separator between groups,
 * or at least ten bare digits — so `+91 98765 43210`, `98765-43210` and
 * `9876543210` all match, while `50000`, `2026` and `1,00,000` do not.
 */
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]*)?(?:\(\d{1,4}\)[\s.-]*)?\d{2,5}(?:[\s.-]+\d{2,5}){1,4}|\+\d{7,15}|\b\d{10,15}\b/g;

/** Digits only, for the length test that decides whether a match is a number. */
function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/**
 * True when a phone-shaped match is really a phone number.
 *
 * The pattern is loose on purpose, so this is where the false positives are
 * thrown out: anything under seven digits, and anything that is plainly money or
 * a date. An Indian-format amount ("1,00,000") never reaches here because commas
 * are not separators in the pattern, but a hyphenated date range can.
 */
function looksLikePhone(match: string): boolean {
  const digits = digitCount(match);
  if (digits < 7 || digits > 15) {
    return false;
  }
  // A date range or a version: 2026-09-27, 1.2.3, 10-12-2026.
  if (/^\d{1,4}([.\-/])\d{1,2}\1\d{1,4}$/.test(match.trim())) {
    return false;
  }
  return true;
}

/**
 * Replaces every e-mail address and phone number in `text` with {@link REDACTED}.
 *
 * Consecutive replacements collapse into one, so "Call 98765 43210 or write to
 * a@b.com" does not end up saying the same sentence twice.
 *
 * Idempotent: running it over its own output changes nothing, which is what lets
 * it be applied at the adapter boundary *and* again before anything is stored,
 * without the placeholder accumulating.
 */
export function redact(text: string, warnings?: WarningCollector, field?: string): string {
  let redacted = false;
  let result = text.replace(EMAIL_PATTERN, () => {
    redacted = true;
    return REDACTED;
  });
  result = result.replace(PHONE_PATTERN, (match) => {
    if (!looksLikePhone(match)) {
      return match;
    }
    redacted = true;
    // Whitespace the match swallowed at its edges is put back, so words do not
    // run together where a number used to be.
    const leading = /^\s*/.exec(match)?.[0] ?? '';
    const trailing = /\s*$/.exec(match)?.[0] ?? '';
    return `${leading}${REDACTED}${trailing}`;
  });

  if (redacted) {
    // "…] or [contact details…" and "…] , [contact details…" both collapse.
    const escaped = REDACTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp(`${escaped}(?:\\s*(?:,|/|or|and|\\||;)?\\s*${escaped})+`, 'gi'),
      REDACTED,
    );
    warnings?.add('PII_REDACTED', 'Contact details were replaced (D-29).', field);
  }
  return result;
}

/** True when `text` still holds something that looks like a contact detail. */
export function hasContactDetails(text: string): boolean {
  EMAIL_PATTERN.lastIndex = 0;
  if (EMAIL_PATTERN.test(text)) {
    EMAIL_PATTERN.lastIndex = 0;
    return true;
  }
  PHONE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(PHONE_PATTERN)) {
    if (looksLikePhone(match[0])) {
      return true;
    }
  }
  return false;
}
