import axe, { type AxeResults, type ElementContext, type RunOptions } from 'axe-core';

/**
 * The accessibility matcher the §19 acceptance criterion is checked with:
 * `await expect(container).toBeAccessible()`.
 *
 * It is thirty lines over `axe-core` rather than a second dependency
 * (`jest-axe`/`vitest-axe`), which exist mainly to bridge Jest's matcher API and
 * bring their own copy of axe with them.
 *
 * `color-contrast` is disabled, and not because it is inconvenient: vitest does
 * not process CSS, so in jsdom every element computes as transparent on
 * transparent and the rule can only report false results either way. Contrast is
 * measured properly in `tokens.contrast.test.ts`, against the token file itself.
 */
const DEFAULT_OPTIONS: RunOptions = {
  rules: { 'color-contrast': { enabled: false } },
  resultTypes: ['violations'],
};

export async function runAxe(
  context: ElementContext,
  options: RunOptions = {},
): Promise<AxeResults> {
  return axe.run(context, { ...DEFAULT_OPTIONS, ...options });
}

function describe(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const where = violation.nodes.map((node) => `      ${node.html}`).join('\n');
      return `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n${where}`;
    })
    .join('\n');
}

export const axeMatchers = {
  async toBeAccessible(
    this: { isNot: boolean },
    received: ElementContext,
    options: RunOptions = {},
  ): Promise<{ pass: boolean; message: () => string }> {
    const results = await runAxe(received, options);
    const pass = results.violations.length === 0;
    return {
      pass,
      message: () =>
        pass
          ? 'expected accessibility violations, but axe found none'
          : `axe found ${String(results.violations.length)} violation(s):\n${describe(results)}`,
    };
  },
};

declare module 'vitest' {
  // The type parameter has to be spelled exactly as vitest spells it, or the
  // two declarations do not merge (TS2428) — so it is declared and unused, and
  // the matcher is typed as the promise it really is.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>> {
    /** Runs axe-core over the element and fails with every violation listed. */
    toBeAccessible: (options?: RunOptions) => Promise<void>;
  }
}
