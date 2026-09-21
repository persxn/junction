import { isAlphabetic } from './text.js';

/**
 * Typo tolerance (§8.2, ruling F5/A5): a vocabulary and a bounded edit
 * distance. Nothing here touches the trigram index — see `trigram.ts` for why
 * the two must not be confused.
 *
 * The contract, from §8.2 and the WP-15a prompt:
 *
 * - only a word with **zero** hits is corrected; a word that finds anything is
 *   what the professor meant, however odd it looks;
 * - the allowance grows with length — nothing under 4 letters, 1 edit for 4–5,
 *   2 for 6 or more — because a two-letter word is one edit from half the
 *   dictionary;
 * - the best candidate is the closest, then the most common;
 * - every correction is **reported** ("Showing results for hackathon (searched
 *   hackthon)"); a silent one would make a professor distrust every result.
 *
 * Distance is optimal string alignment (Levenshtein plus adjacent
 * transposition), so "secuirty" is one edit from "security", as a person would
 * count it.
 */

export interface VocabularyEntry {
  readonly term: string;
  readonly docFreq: number;
}

/** Edits allowed for a word of this many letters. */
export function maxEditsFor(length: number): number {
  if (length < 4) {
    return 0;
  }
  return length <= 5 ? 1 : 2;
}

/**
 * Optimal-string-alignment distance, or `max + 1` as soon as the answer is
 * known to exceed `max` — the vocabulary scan calls this tens of thousands of
 * times per corrected word, so the early exit is the whole point.
 */
export function boundedDistance(a: string, b: string, max: number): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > max) {
    return max + 1;
  }
  let previous2: number[] = [];
  let previous = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? Infinity) + 1,
        (current[j - 1] ?? Infinity) + 1,
        (previous[j - 1] ?? Infinity) + cost,
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        value = Math.min(value, (previous2[j - 2] ?? Infinity) + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) {
      return max + 1;
    }
    previous2 = previous;
    previous = current;
  }
  return Math.min(previous[t.length] ?? max + 1, max + 1);
}

export interface Candidate {
  readonly term: string;
  readonly docFreq: number;
  readonly distance: number;
}

/**
 * The closest vocabulary term within the allowance for `word`, ties broken by
 * document frequency and then alphabetically so the answer never depends on
 * the order the vocabulary was read in. An exact match is not a correction.
 */
export function bestCorrection(
  word: string,
  vocabulary: readonly VocabularyEntry[],
): Candidate | undefined {
  const max = maxEditsFor([...word].length);
  if (max === 0) {
    return undefined;
  }
  let best: Candidate | undefined;
  for (const entry of vocabulary) {
    if (entry.term === word) {
      continue;
    }
    const distance = boundedDistance(word, entry.term, max);
    if (distance > max) {
      continue;
    }
    const candidate = { term: entry.term, docFreq: entry.docFreq, distance };
    if (best === undefined || better(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.distance !== b.distance) {
    return a.distance < b.distance;
  }
  if (a.docFreq !== b.docFreq) {
    return a.docFreq > b.docFreq;
  }
  return a.term < b.term;
}

export interface CorrectionInput {
  readonly words: readonly string[];
  readonly vocabulary: readonly VocabularyEntry[];
  /** Words an alias expansion claimed; never corrected. */
  readonly protectedWords: ReadonlySet<string>;
  /** Whether a single word finds any visible event on its own. */
  readonly hasHits: (word: string) => boolean;
}

export interface CorrectionResult {
  readonly words: readonly string[];
  readonly corrected: boolean;
}

/**
 * Corrects each zero-hit word in turn.
 *
 * A zero-hit word is also tried **joined to its neighbour**, because the most
 * common way to miss a compound is to split it: "cyber secuirty" is one edit
 * from "cybersecurity", and correcting only the second word would search for
 * "cyber security" and miss the event that spells it as one word. On a tie
 * between a joined and a single candidate the joined one wins, for that reason.
 */
export function correctWords(input: CorrectionInput): CorrectionResult {
  const out: string[] = [];
  let corrected = false;
  const correctable = (word: string): boolean =>
    isAlphabetic(word) && !input.protectedWords.has(word);

  let index = 0;
  while (index < input.words.length) {
    const word = input.words[index] ?? '';
    if (!correctable(word) || maxEditsFor([...word].length) === 0 || input.hasHits(word)) {
      out.push(word);
      index += 1;
      continue;
    }

    const options: { merge: 'PREV' | 'NEXT' | 'NONE'; candidate: Candidate }[] = [];
    const previous = input.words[index - 1];
    const next = input.words[index + 1];
    const lastOut = out[out.length - 1];
    if (previous !== undefined && lastOut === previous && correctable(previous)) {
      const found = bestCorrection(previous + word, input.vocabulary);
      if (found !== undefined) options.push({ merge: 'PREV', candidate: found });
    }
    if (next !== undefined && correctable(next)) {
      const found = bestCorrection(word + next, input.vocabulary);
      if (found !== undefined) options.push({ merge: 'NEXT', candidate: found });
    }
    const alone = bestCorrection(word, input.vocabulary);
    if (alone !== undefined) options.push({ merge: 'NONE', candidate: alone });

    // Stable sort keeps the joined options ahead of the single one on a tie.
    const chosen = [...options].sort((a, b) =>
      a.candidate.distance !== b.candidate.distance
        ? a.candidate.distance - b.candidate.distance
        : a.merge === 'NONE' && b.merge !== 'NONE'
          ? 1
          : b.merge === 'NONE' && a.merge !== 'NONE'
            ? -1
            : b.candidate.docFreq - a.candidate.docFreq,
    )[0];
    if (chosen === undefined) {
      out.push(word);
      index += 1;
      continue;
    }
    corrected = true;
    if (chosen.merge === 'PREV') {
      out.pop();
      out.push(chosen.candidate.term);
      index += 1;
    } else if (chosen.merge === 'NEXT') {
      out.push(chosen.candidate.term);
      index += 2;
    } else {
      out.push(chosen.candidate.term);
      index += 1;
    }
  }
  return { words: out, corrected };
}

/** The sentence the UI shows, verbatim (§8.2). */
export function correctionMessage(searched: string, used: string): string {
  return `Showing results for ${used} (searched ${searched})`;
}
