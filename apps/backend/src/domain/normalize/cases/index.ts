import type { NormalizeCase } from './case.js';
import { CLASSIFY_CASES } from './classify.cases.js';
import { DATE_CASES } from './dates.cases.js';
import { MONEY_CASES } from './money.cases.js';
import { SHAPE_CASES } from './shape.cases.js';
import { TEXT_CASES } from './text.cases.js';

export * from './case.js';

/**
 * Every normalization case, by family (§7.3's acceptance criterion).
 *
 * The runner asserts a floor on the total so the count cannot quietly rot, and
 * asserts that each named case §7.3 calls out is present by name — a case
 * renamed out of existence is the failure mode a bare count would miss.
 */
export const CASES_BY_FAMILY: Readonly<Record<string, readonly NormalizeCase[]>> = {
  dates: DATE_CASES,
  money: MONEY_CASES,
  classify: CLASSIFY_CASES,
  text: TEXT_CASES,
  shape: SHAPE_CASES,
};

export const ALL_CASES: readonly NormalizeCase[] = Object.values(CASES_BY_FAMILY).flat();
