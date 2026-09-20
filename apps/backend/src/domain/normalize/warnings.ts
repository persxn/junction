import type { ParseWarning, ParseWarningCode } from '@compintel/contracts';

/**
 * Collecting the things normalization could not do (§7.3).
 *
 * A warning is not an error: the candidate is still produced, with the field it
 * concerns left **absent**. That is the whole discipline of this library — a
 * wrong deadline is worse than an unknown one, so nothing is ever guessed, and
 * every gap says why it is there.
 *
 * The collector is a plain array behind a tiny interface so the per-family
 * functions can be called on their own in a test and still report.
 */
export class WarningCollector {
  readonly #warnings: ParseWarning[] = [];

  add(code: ParseWarningCode, message: string, field?: string): void {
    this.#warnings.push({ code, message, ...(field === undefined ? {} : { field }) });
  }

  /** In the order they happened; the UI shows them under the field. */
  all(): readonly ParseWarning[] {
    return [...this.#warnings];
  }

  get length(): number {
    return this.#warnings.length;
  }

  has(code: ParseWarningCode): boolean {
    return this.#warnings.some((warning) => warning.code === code);
  }
}
