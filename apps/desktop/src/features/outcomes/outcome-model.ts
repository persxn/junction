import type { CompetitionDetail, EngagementStatus } from '@compintel/contracts';

/**
 * The outcome panel's logic that is not drawing (WP-21, R104, R63): when
 * "Record outcome" is offered and why not, and a prize amount between the
 * form's decimal text and the stored minor units — in its own currency, never
 * converted.
 */

/** Same words as the server's `recordBlockedReason`. */
export function recordBlockedReason(status: EngagementStatus): string | undefined {
  if (status === 'PARTICIPATING' || status === 'COMPLETED') return undefined;
  if (status === 'WITHDRAWN' || status === 'NOT_SELECTED') {
    return 'This competition closed without taking part, so it has no result.';
  }
  return 'Record the result once the competition is underway.';
}

export function canRecordOutcome(competition: Pick<CompetitionDetail, 'status' | 'can'>): boolean {
  return recordBlockedReason(competition.status) === undefined && competition.can.edit;
}

/** How many minor units a currency's major unit has (INR 2, JPY 0); 2 when unknown. */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** "50000.5" in INR → 5000050; empty → null; not a number → undefined. */
export function toMinor(text: string, currency: string): number | null | undefined {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const digits = minorDigits(currency);
  return Math.round(Number(trimmed) * 10 ** digits);
}

export function fromMinor(minor: number | null, currency: string | null): string {
  if (minor === null || currency === null) return '';
  return (minor / 10 ** minorDigits(currency)).toString();
}

/** "₹50,000.00" — the amount in its own currency, as entered (R63). */
export function formatPrize(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(
      minor / 10 ** minorDigits(currency),
    );
  } catch {
    return `${currency} ${String(minor)}`;
  }
}
