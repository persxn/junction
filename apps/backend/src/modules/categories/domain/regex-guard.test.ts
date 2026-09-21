import { describe, expect, it } from 'vitest';

import {
  checkRegex,
  hasNestedUnboundedQuantifier,
  REGEX_CHAR_BUDGET,
  testBounded,
} from './regex-guard.js';

describe('the nested-quantifier check', () => {
  it.each([
    '(a+)+',
    '(a*)*',
    '(\\w+\\s?)*$',
    '^(a|aa)+(b+)+$',
    '((ab)+c)*',
    '(x+){2,10}',
    '(?:[a-z]+)+@',
    '(.*a){3,}',
  ])('refuses %s', (pattern) => {
    expect(hasNestedUnboundedQuantifier(pattern)).toBe(true);
    const verdict = checkRegex(pattern);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? undefined : verdict.unsafe).toBe(true);
  });

  it.each([
    '\\bctf\\b',
    '\\brobo(tics|wars?|race)\\b',
    '(ab)+',
    '(a+b)',
    '[(+*)]+',
    '\\(a+\\)+',
    'hack(athon)?s?',
    '(x+){1}',
    '\\p{L}+',
  ])('accepts %s', (pattern) => {
    expect(hasNestedUnboundedQuantifier(pattern)).toBe(false);
    expect(checkRegex(pattern).ok).toBe(true);
  });
});

describe('checkRegex', () => {
  it('refuses over 200 characters, a pattern that does not compile, and one that matches empty text', () => {
    expect(checkRegex('a'.repeat(201)).ok).toBe(false);
    expect(checkRegex('(unclosed').ok).toBe(false);
    expect(checkRegex('\\p{Nope}').ok).toBe(false); // the `u` flag makes this an error
    expect(checkRegex('x*').ok).toBe(false);
  });

  it('compiles case-insensitive and Unicode-aware', () => {
    const verdict = checkRegex('résumé');
    expect(verdict.ok && verdict.regex.flags).toBe('iu');
    expect(verdict.ok && testBounded(verdict.regex, 'RÉSUMÉ')).toBe(true);
  });
});

describe('testBounded', () => {
  it('reads no further than the character budget', () => {
    const verdict = checkRegex('needle');
    if (!verdict.ok) throw new Error('should compile');
    const far = `${'x'.repeat(REGEX_CHAR_BUDGET)}needle`;
    const near = `${'x'.repeat(REGEX_CHAR_BUDGET - 10)}needle`;
    expect(testBounded(verdict.regex, far)).toBe(false);
    expect(testBounded(verdict.regex, near)).toBe(true);
  });
});
