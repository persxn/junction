import type { EventCandidate, ParseWarningCode } from '@compintel/contracts';

import type { NormalizeContext, RawCandidate } from '../index.js';

/**
 * One normalization case (§7.3's acceptance criterion).
 *
 * The suite is a table rather than a hundred `it()` blocks on purpose: adding a
 * case a source taught us should be one line in a list, not a new test function,
 * and the whole table can then be read in one sitting to see what the library
 * actually promises.
 *
 * Every case runs against the same fixed clock, so "next Friday" means one
 * instant forever.
 */
export interface NormalizeCase {
  /** What this case is about, in the `it()` name. */
  readonly name: string;
  /** Merged over {@link BASE_INPUT}; only the interesting fields are stated. */
  readonly input: Partial<RawCandidate>;
  /** Merged over {@link BASE_CONTEXT} — what the adapter knows, not the record. */
  readonly ctx?: Partial<NormalizeContext>;
  readonly expect: CaseExpectation;
}

export interface CaseExpectation {
  /**
   * Paths that must hold these values, compared with deep equality. A path is
   * dotted (`startsAt.at`, `fee.minor`), so a case can assert one field of a
   * nested value without restating the rest of it.
   */
  readonly fields?: Readonly<Record<string, unknown>>;
  /** Paths that must be *less than* these values — for confidences. */
  readonly lessThan?: Readonly<Record<string, number>>;
  /** Warning codes that must all be present. */
  readonly warnings?: readonly ParseWarningCode[];
  /** Warning codes that must **not** be present. */
  readonly noWarnings?: readonly ParseWarningCode[];
  /** Top-level fields that must be absent — the "nothing is guessed" assertion. */
  readonly absent?: readonly (keyof EventCandidate)[];
}

/**
 * Reads a dotted path out of a candidate; `undefined` for anything missing.
 * Strings and arrays answer `.length`, so a case can assert a summary's size
 * without restating five hundred characters.
 */
export function valueAt(candidate: EventCandidate, path: string): unknown {
  let current: unknown = candidate;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'string' || Array.isArray(current)) {
      current =
        part === 'length' ? current.length : (current as unknown as Record<string, unknown>)[part];
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * The minimum a candidate needs, so a case can state only what it is testing.
 * Deliberately boring: no dates, no fee, no description, so anything a case does
 * not mention is genuinely absent rather than inherited.
 */
export const BASE_INPUT: RawCandidate = {
  sourceKey: 'testsource',
  externalKey: 'e-1',
  url: 'https://example.org/events/1',
  title: 'Example Event',
};

/** Every case runs at this instant (a Sunday, 14:30 IST). */
export const CASE_NOW = '2026-09-20T09:00:00.000Z';

/**
 * What a typical Indian source's adapter would configure. A case that is about
 * having *no* zone anywhere overrides `sourceTimezone` to `undefined`.
 */
export const BASE_CONTEXT: Omit<NormalizeContext, 'clock'> = {
  sourceTimezone: 'Asia/Kolkata',
};
