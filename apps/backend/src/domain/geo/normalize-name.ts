/**
 * Turning a place or institution name into something two spellings of it share
 * (§4.17, ruling R55).
 *
 * The problem this solves is mundane and constant. A source writes "Guru Nanak
 * Institute of Technology, Sodepur", the seed says "Guru Nanak Institute of
 * Technology", a student writes "GNIT" and the gazetteer has "Sodepur". None of
 * those match as strings, and all of them mean the same campus.
 *
 * The approach is deliberately dull: fold case and accents, drop punctuation,
 * expand the handful of Indian institute abbreviations that are genuinely
 * unambiguous, and drop the connective words that carry no identity. What it
 * does *not* do is anything clever — no phonetics, no edit distance here. Those
 * belong in `match.ts` where a score can be thresholded and explained, not in a
 * key that has to be exact for an index lookup to work.
 */

/**
 * Words that appear in half of all institution names and identify none of them.
 * "of", "the" and friends, plus the organisational boilerplate.
 */
const NOISE_WORDS = new Set([
  'the',
  'of',
  'and',
  'for',
  'at',
  'in',
  'a',
  'an',
  'institute',
  'institutes',
  'institution',
  'institutions',
  'college',
  'colleges',
  'university',
  'universities',
  'school',
  'schools',
  'academy',
  'campus',
  'centre',
  'center',
  'department',
  'dept',
  'faculty',
  'society',
  'trust',
  'group',
]);

/**
 * Abbreviations worth expanding because they are how people actually write these
 * institutions, and because each is unambiguous in Indian usage.
 *
 * Kept short on purpose. An abbreviation that could mean two things — "IIM" for
 * a management institute in a product about hackathons, say — earns nothing and
 * risks a wrong match, so it is not here.
 */
const EXPANSIONS: Readonly<Record<string, string>> = {
  iit: 'indian institute technology',
  nit: 'national institute technology',
  iiit: 'indian institute information technology',
  iisc: 'indian institute science',
  iiser: 'indian institute science education research',
  bits: 'birla institute technology science',
  vit: 'vellore institute technology',
  srm: 'srm',
  nift: 'national institute fashion technology',
  aiims: 'all india institute medical sciences',
};

/**
 * Case-folded, accent-stripped, punctuation-free, whitespace-collapsed.
 *
 * This is the *exact* key an index lookup uses, so it must be stable: two names
 * that normalize to the same string are treated as the same place without any
 * further scoring.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The tokens a name is worth matching on: normalized, expanded, and with the
 * noise words removed.
 *
 * Returns an ordered, de-duplicated list. Order is kept because it is cheap and
 * occasionally informative; the scoring in `match.ts` treats it as a set.
 */
export function nameTokens(name: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const raw of normalizeName(name).split(' ')) {
    if (raw.length === 0) {
      continue;
    }
    const expansion = EXPANSIONS[raw];
    const parts = expansion === undefined ? [raw] : expansion.split(' ');
    for (const part of parts) {
      if (NOISE_WORDS.has(part) || part.length === 0) {
        continue;
      }
      if (!seen.has(part)) {
        seen.add(part);
        tokens.push(part);
      }
    }
  }

  // A name made entirely of noise ("The Institute") still has to match itself,
  // so fall back to the normalized form rather than returning nothing.
  if (tokens.length === 0) {
    const fallback = normalizeName(name);
    return fallback.length === 0 ? [] : fallback.split(' ');
  }
  return tokens;
}

/**
 * The key stored in `places.name_key` and `institutions`' alias index: the
 * significant tokens, sorted, joined by a space.
 *
 * Sorted so that "Institute of Technology, Guru Nanak" and "Guru Nanak Institute
 * of Technology" produce the same key — sources reorder names constantly, and a
 * word-order difference is not a different place.
 */
export function nameKey(name: string): string {
  return [...nameTokens(name)].sort().join(' ');
}
