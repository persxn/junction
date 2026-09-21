/**
 * Titles, as §7.5 compares them: after removing years and generic words, by a
 * token-set ratio. Pure.
 *
 * "HackX 2026", "The HackX Hackathon" and "HackX — Season 3 Edition" are the
 * same name for matching purposes. What is left after the filler goes is the
 * part that actually names the event, and the year is deliberately absent here
 * because the edition guard (R64) judges it separately and first.
 */

/** Words that say *what kind* of thing an event is, not *which* one (§7.5). */
const FILLER = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'hackathon',
  'hackathons',
  'hack',
  'season',
  'edition',
  'annual',
  'official',
]);

/** "2026", "2025-26", "v3", "3rd", "iii" as an edition marker. */
const YEAR = /^(?:19|20)\d{2}$/;
const EDITION_MARKER = /^(?:v\d+|\d+(?:st|nd|rd|th)|ii|iii|iv|vi|vii|viii|ix)$/;

/** The tokens that name an event, lower-cased, ASCII-folded, filler removed. */
export function titleTokens(title: string): string[] {
  return (
    title
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      // "2025-26" is one year range, not a year and a stray "26".
      .replace(/\b(?:19|20)\d{2}\s*[-–/]\s*\d{2}\b/gu, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter(
        (token) =>
          token.length > 0 &&
          !FILLER.has(token) &&
          !YEAR.test(token) &&
          !EDITION_MARKER.test(token),
      )
  );
}

/** §7.5's normalized title: the naming tokens, space-joined. */
export function normalizeTitle(title: string): string {
  return titleTokens(title).join(' ');
}

/** Levenshtein distance, two rows at a time. */
function distance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** 1 for identical strings, 0 for nothing in common; (|a| + |b| − d) / (|a| + |b|). */
export function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) {
    return 0;
  }
  return (total - distance(a, b)) / total;
}

/**
 * Token-set ratio over two token lists: compare the shared tokens with each
 * side's shared-plus-rest, and keep the best. "HackX National Finals" against
 * "HackX" scores well on the shared part without pretending the rest matches.
 * Zero when either side has no naming tokens at all — nothing to compare is not
 * a match.
 */
export function tokenSetRatio(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const a = new Set(left);
  const b = new Set(right);
  const shared = [...a].filter((token) => b.has(token)).sort();
  const onlyA = [...a].filter((token) => !b.has(token)).sort();
  const onlyB = [...b].filter((token) => !a.has(token)).sort();
  const base = shared.join(' ');
  const withA = [base, ...onlyA].filter(Boolean).join(' ');
  const withB = [base, ...onlyB].filter(Boolean).join(' ');
  const scores = [ratio(withA, withB)];
  if (base.length > 0) {
    scores.push(ratio(base, withA), ratio(base, withB));
  }
  return Math.max(...scores);
}

/** §7.5's title feature. */
export function titleSimilarity(left: string, right: string): number {
  return tokenSetRatio(titleTokens(left), titleTokens(right));
}

/** Character trigrams of the normalized title, padded so short names still have some. */
export function trigrams(title: string): Set<string> {
  const text = `  ${normalizeTitle(title)} `;
  const out = new Set<string>();
  for (let index = 0; index + 3 <= text.length; index += 1) {
    out.add(text.slice(index, index + 3));
  }
  return out;
}

/** Jaccard overlap of two titles' trigram sets, 0–1. */
export function trigramOverlap(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) {
      shared += 1;
    }
  }
  return shared / (a.size + b.size - shared);
}
