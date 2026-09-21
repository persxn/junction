/**
 * Text as the rules engine sees it (D-15). One normalization for rules and
 * events alike, so a rule written "Machine-Learning" and a title saying
 * "machine learning" meet in the middle: diacritics removed, case folded,
 * anything that is not a letter or a digit a word boundary.
 */

const NOT_WORD = /[^\p{L}\p{N}]+/u;
const COMBINING = /\p{M}+/gu;

/** Lower-case, diacritics removed; spacing untouched. */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(COMBINING, '').toLowerCase();
}

/** Whole words, in order. "AI-powered chair" → ["ai", "powered", "chair"]. */
export function tokens(text: string): string[] {
  return fold(text)
    .split(NOT_WORD)
    .filter((token) => token.length > 0);
}

/** A source tag as compared: folded, trimmed, single-spaced — punctuation kept ("ui/ux"). */
export function normalizeTag(tag: string): string {
  return fold(tag).trim().replace(/\s+/g, ' ');
}

/** Whether `needle` occurs in `haystack` as a contiguous run of whole words. */
export function containsPhrase(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}
