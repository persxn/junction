import { CATEGORY_RULE_PATTERN_MAX } from '@compintel/contracts';

/**
 * The REGEX rule guard (WP-15b step 3). A rule runs on every ingest, so one
 * pattern that backtracks without bound would hang the scrape that met the
 * wrong title. Three lines of defence:
 *
 * 1. at write time, a pattern over 200 characters, one that does not compile
 *    with the `u` flag, or one that matches empty text (and so every event) is
 *    refused;
 * 2. at write time, **nested unbounded quantifiers** — a group that contains
 *    `*`, `+` or `{n,}` and is itself repeated, `(a+)+`, `(\w*)*`, `(x+){2,9}` —
 *    are refused as unsafe: that shape is what catastrophic backtracking needs;
 * 3. at run time, each evaluation reads at most {@link REGEX_CHAR_BUDGET}
 *    characters.
 *
 * What (2) does not see: alternations whose branches overlap, `(a|a)*`. Line
 * (3) bounds the input, which bounds the damage; the handoff records the gap.
 */

/** Characters a single REGEX evaluation may read. */
export const REGEX_CHAR_BUDGET = 20_000;

/** Flags every REGEX rule is compiled with: Unicode, case-insensitive. */
export const REGEX_FLAGS = 'iu';

export type RegexVerdict =
  | { readonly ok: true; readonly regex: RegExp }
  | { readonly ok: false; readonly unsafe: boolean; readonly message: string };

interface Group {
  hasUnbounded: boolean;
}

/** The quantifier at `index`, if any: its length and whether it repeats (max > 1) / is unbounded. */
function quantifierAt(
  pattern: string,
  index: number,
): { length: number; repeats: boolean; unbounded: boolean } | undefined {
  const char = pattern[index];
  let length: number;
  let repeats: boolean;
  let unbounded: boolean;
  if (char === '*' || char === '+') {
    length = 1;
    repeats = true;
    unbounded = true;
  } else if (char === '?') {
    length = 1;
    repeats = false;
    unbounded = false;
  } else if (char === '{') {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index));
    if (match === null) {
      return undefined;
    }
    length = match[0].length;
    const max =
      match[2] === undefined ? Number(match[1]) : match[3] === '' ? Infinity : Number(match[3]);
    repeats = max > 1;
    unbounded = max === Infinity;
  } else {
    return undefined;
  }
  // A lazy or possessive-looking suffix does not change what repeats.
  if (pattern[index + length] === '?') {
    length += 1;
  }
  return { length, repeats, unbounded };
}

/** Index just past an escape starting at `index` (a backslash). */
function skipEscape(pattern: string, index: number): number {
  const next = pattern[index + 1];
  if (
    (next === 'p' || next === 'P' || next === 'u' || next === 'k') &&
    pattern[index + 2] === '{'
  ) {
    const close = pattern.indexOf('}', index + 2);
    return close === -1 ? pattern.length : close + 1;
  }
  if (next === 'k' && pattern[index + 2] === '<') {
    const close = pattern.indexOf('>', index + 2);
    return close === -1 ? pattern.length : close + 1;
  }
  return index + 2;
}

/** Index just past a character class starting at `index` (a `[`). */
function skipClass(pattern: string, index: number): number {
  let cursor = index + 1;
  while (cursor < pattern.length && pattern[cursor] !== ']') {
    cursor = pattern[cursor] === '\\' ? skipEscape(pattern, cursor) : cursor + 1;
  }
  return cursor + 1;
}

/** True when some repeated group contains an unbounded quantifier. */
export function hasNestedUnboundedQuantifier(pattern: string): boolean {
  const stack: Group[] = [{ hasUnbounded: false }];
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    let atomEnd: number;
    let closed: Group | undefined;
    if (char === '\\') {
      atomEnd = skipEscape(pattern, index);
    } else if (char === '[') {
      atomEnd = skipClass(pattern, index);
    } else if (char === '(') {
      stack.push({ hasUnbounded: false });
      index += 1;
      continue;
    } else if (char === ')') {
      closed = stack.length > 1 ? stack.pop() : undefined;
      atomEnd = index + 1;
    } else {
      atomEnd = index + 1;
    }
    const quantifier = quantifierAt(pattern, atomEnd);
    const current = stack[stack.length - 1]!;
    if (closed?.hasUnbounded === true) {
      if (quantifier?.repeats === true) {
        return true;
      }
      current.hasUnbounded = true;
    }
    if (quantifier?.unbounded === true) {
      current.hasUnbounded = true;
    }
    index = atomEnd + (quantifier?.length ?? 0);
  }
  return false;
}

/** The write-time verdict on a REGEX rule's pattern. */
export function checkRegex(pattern: string): RegexVerdict {
  if (pattern.length === 0 || pattern.length > CATEGORY_RULE_PATTERN_MAX) {
    return {
      ok: false,
      unsafe: false,
      message: `A pattern is 1–${String(CATEGORY_RULE_PATTERN_MAX)} characters.`,
    };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, REGEX_FLAGS);
  } catch (error) {
    return {
      ok: false,
      unsafe: false,
      message: `The pattern does not compile: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (hasNestedUnboundedQuantifier(pattern)) {
    return {
      ok: false,
      unsafe: true,
      message:
        'The pattern repeats a group that already repeats without limit, which can make matching take forever. Rewrite it without the nested quantifier.',
    };
  }
  if (regex.test('')) {
    return {
      ok: false,
      unsafe: false,
      message: 'The pattern matches empty text, so it would put every event in the category.',
    };
  }
  return { ok: true, regex };
}

/** One bounded evaluation. */
export function testBounded(regex: RegExp, text: string): boolean {
  regex.lastIndex = 0;
  return regex.test(text.length > REGEX_CHAR_BUDGET ? text.slice(0, REGEX_CHAR_BUDGET) : text);
}
