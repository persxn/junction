import type { EngagementStatus, OutcomeInput, OutcomeResult } from '@compintel/contracts';

/**
 * R104's rules for an outcome, pure (WP-21): when one may be recorded, and
 * what its fields may hold. A refusal is a sentence for the form.
 */

/** Recording is allowed once the competition has happened. */
export const RECORDABLE: readonly EngagementStatus[] = ['PARTICIPATING', 'COMPLETED'];

export const canRecord = (status: EngagementStatus): boolean => RECORDABLE.includes(status);

/** Why "Record outcome" is not offered, in words; undefined when it is. */
export function recordBlockedReason(status: EngagementStatus): string | undefined {
  if (canRecord(status)) return undefined;
  if (status === 'WITHDRAWN' || status === 'NOT_SELECTED') {
    return 'This competition closed without taking part, so it has no result.';
  }
  return 'Record the result once the competition is underway.';
}

export interface ValidOutcome {
  readonly result: OutcomeResult;
  readonly rank: number | null;
  readonly prizeText: string | null;
  readonly prizeMinor: number | null;
  readonly prizeCurrency: string | null;
  readonly resultUrl: string | null;
  readonly notes: string | null;
  readonly feedback: string | null;
}

export type Validated =
  | { readonly ok: true; readonly value: ValidOutcome }
  | { readonly ok: false; readonly problem: string };

const blank = (text: string | null | undefined): string | null =>
  text === undefined || text === null || text.trim() === '' ? null : text.trim();

function isHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

export function validateOutcome(input: OutcomeInput): Validated {
  const rank = input.rank ?? null;
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    return { ok: false, problem: 'A rank is a whole number from 1 up.' };
  }
  const prizeMinor = input.prizeMinor ?? null;
  const prizeCurrency = blank(input.prizeCurrency);
  if ((prizeMinor === null) !== (prizeCurrency === null)) {
    return {
      ok: false,
      problem: 'A prize amount needs its currency, and a currency needs an amount.',
    };
  }
  if (prizeMinor !== null && (!Number.isInteger(prizeMinor) || prizeMinor < 0)) {
    return { ok: false, problem: 'A prize amount cannot be negative.' };
  }
  if (prizeCurrency !== null && !/^[A-Z]{3}$/.test(prizeCurrency)) {
    return {
      ok: false,
      problem: 'A currency is its three-letter code in capitals, such as INR or USD.',
    };
  }
  const resultUrl = blank(input.resultUrl);
  if (resultUrl !== null && !isHttp(resultUrl)) {
    return { ok: false, problem: 'A result link must be a web address (http or https).' };
  }
  return {
    ok: true,
    value: {
      result: input.result,
      rank,
      prizeText: blank(input.prizeText),
      prizeMinor,
      prizeCurrency,
      resultUrl,
      notes: blank(input.notes),
      feedback: blank(input.feedback),
    },
  };
}
