import { quoteFts } from './text.js';

/**
 * Substring matching over title and organizer (§8.2, ruling F5/A5).
 *
 * `event_fts_trigram` answers one question: does this fragment occur inside
 * the title or the organizer? "ackath" is inside "Hackathon", and the word index
 * cannot say so because "ackath" is not a word. That is all it does.
 *
 * **It is not typo tolerance.** A trigram index matches a misspelling only by
 * accident, when enough of it survives intact; "hackthon" shares no substring
 * of any length with "hackathon" beyond "hack" and "thon". Typos are
 * `typo.ts`'s job, over a vocabulary with a bounded edit distance, and the two
 * are separate modules with separate tests because §8.2's wording once led a
 * reader to build one out of the other.
 */

/** FTS5's trigram tokenizer cannot match anything shorter than this. */
export const TRIGRAM_MIN_CHARS = 3;

/** The whitespace-separated fragments of a query, kept verbatim (punctuation included). */
export function trigramChunks(text: string): string[] {
  return text
    .trim()
    .split(/\s+/u)
    .filter((chunk) => chunk.length > 0);
}

/**
 * The MATCH expression for `event_fts_trigram`, or `undefined` when there is
 * none to run.
 *
 * Every fragment must be at least three characters. A shorter one cannot be
 * looked up, and dropping it would make this branch *looser* than the word
 * branch it is unioned with — "ml ackath" would return every hackathon, ML or
 * not — so a query with any short fragment simply has no substring branch.
 * Fragments are AND-ed and quoted; the tokenizer folds case and diacritics.
 */
export function trigramMatchExpression(text: string): string | undefined {
  const chunks = trigramChunks(text);
  if (chunks.length === 0 || chunks.some((chunk) => [...chunk].length < TRIGRAM_MIN_CHARS)) {
    return undefined;
  }
  return chunks.map((chunk) => quoteFts(chunk)).join(' AND ');
}
