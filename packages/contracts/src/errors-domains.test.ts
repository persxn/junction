import { describe, expect, it } from 'vitest';

import { COMMON_ERROR_CODES, ERROR_CODE_DOMAINS, ERROR_CODES } from './errors.js';

/**
 * Ruling R12's domains: every non-common code starts with a registered domain
 * (split from `errors.test.ts` in WP-24, which brought the first two-word
 * domain, `SAVED_SEARCH`).
 */

/** The longest registered domain a code starts with (`SAVED_SEARCH_…` is SAVED_SEARCH, not SAVED). */
function domainOf(code: string): string | undefined {
  return [...ERROR_CODE_DOMAINS]
    .sort((a, b) => b.length - a.length)
    .find((domain) => code.startsWith(`${domain}_`));
}

describe('the error-code domains (ruling R12)', () => {
  it('gives every non-common code a registered domain prefix', () => {
    const common = new Set<string>(COMMON_ERROR_CODES);
    for (const code of ERROR_CODES) {
      if (common.has(code)) {
        continue;
      }
      expect(domainOf(code), code).toBeDefined();
    }
  });

  it('uses SCREAMING_SNAKE throughout', () => {
    for (const code of ERROR_CODES) {
      expect(code, code).toMatch(/^[A-Z]+(_[A-Z0-9]+)*$/);
    }
  });

  it('gives every non-common code a DOMAIN_NAME shape', () => {
    const common = new Set<string>(COMMON_ERROR_CODES);
    for (const code of ERROR_CODES) {
      if (!common.has(code)) {
        expect(code, code).toMatch(/^[A-Z]+_[A-Z0-9_]+$/);
      }
    }
  });

  it('has no duplicates across the whole enum', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('declares no domain that nothing uses', () => {
    const used = new Set(
      ERROR_CODES.filter((code) => !new Set<string>(COMMON_ERROR_CODES).has(code)).map(domainOf),
    );
    expect([...ERROR_CODE_DOMAINS].sort()).toStrictEqual([...used].sort());
  });
});
