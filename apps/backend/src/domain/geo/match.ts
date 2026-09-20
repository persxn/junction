import { nameKey, nameTokens } from './normalize-name.js';

/**
 * Matching a name a source wrote against names we hold (§4.17, ruling R55).
 *
 * Two stages, and the order is the point. An **alias lookup** is exact: if the
 * seed says "IIT Bombay" is also "Indian Institute of Technology Bombay", then a
 * source writing either has told us which institution it means and there is
 * nothing to score. Only when that fails does **token-set scoring** run, and
 * only above a stated threshold does it count as a match.
 *
 * The threshold matters more than the algorithm. A wrong institution match puts
 * an event on the wrong campus and 1200 km from where a professor is looking,
 * and nothing downstream will ever notice. An unmatched event merely falls to
 * CITY precision, which is honest and still useful. So the bar is set where a
 * near-miss is refused, and ties are refused too.
 */

/** Anything we can match a name against: an institution, a place, a series. */
export interface Nameable {
  readonly id: string;
  readonly name: string;
  /** Other names for the same thing, from a seed row or a gazetteer column. */
  readonly aliases?: readonly string[];
  /** Used only to break a tie between two otherwise equal matches. */
  readonly population?: number;
}

export interface NameMatch<T extends Nameable> {
  readonly item: T;
  /** 0–1. 1 means an alias or exact-key hit, with nothing scored. */
  readonly score: number;
  readonly via: 'EXACT' | 'ALIAS' | 'TOKENS';
}

/**
 * The score a token-set match must reach to count (R55).
 *
 * 0.82 is where "Guru Nanak Institute of Technology, Sodepur" still matches
 * "Guru Nanak Institute of Technology" — the extra locality token costs it a
 * little — while "National Institute of Technology Durgapur" does **not** match
 * "National Institute of Technology Rourkela", whose shared tokens are all the
 * generic half of the name. Lower and the NITs start matching each other;
 * higher and ordinary extra words like a city or a campus break a real match.
 */
export const NAME_MATCH_THRESHOLD = 0.82;

/**
 * How much better the best match must be than the runner-up (R55).
 *
 * Without this, two institutions with near-identical names would be decided by
 * floating-point noise. A tie is genuinely ambiguous, and R55's answer to
 * ambiguity is to fall back a precision level rather than to guess.
 */
export const TIE_MARGIN = 0.05;

/**
 * Weighted overlap of two token sets.
 *
 * Every token is not worth the same. "technology" appears in most of these names
 * and distinguishes none of them; "sodepur" appears in one. Weighting by inverse
 * document frequency across the candidate set means the rare, identifying tokens
 * decide the match — which is what stops the NITs matching each other.
 */
export function tokenSetScore(
  queryTokens: readonly string[],
  candidateTokens: readonly string[],
  weightOf: (token: string) => number,
): number {
  const query = new Set(queryTokens);
  const candidate = new Set(candidateTokens);
  if (query.size === 0 || candidate.size === 0) {
    return 0;
  }

  let shared = 0;
  let queryWeight = 0;
  let candidateWeight = 0;

  for (const token of query) {
    const weight = weightOf(token);
    queryWeight += weight;
    if (candidate.has(token)) {
      shared += weight;
    }
  }
  for (const token of candidate) {
    candidateWeight += weightOf(token);
  }

  if (queryWeight === 0 || candidateWeight === 0) {
    return 0;
  }
  // The harmonic mean of "how much of the query was found" and "how much of the
  // candidate was used". Either alone is easy to fool: a one-token query matches
  // everything, and a candidate that is a superset matches any subset.
  const recall = shared / queryWeight;
  const precision = shared / candidateWeight;
  return recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
}

/** Inverse document frequency over the candidate names, for {@link tokenSetScore}. */
export function tokenWeights<T extends Nameable>(items: readonly T[]): (token: string) => number {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const token of new Set(nameTokens(item.name))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const total = Math.max(1, items.length);
  return (token) => {
    const seen = counts.get(token) ?? 0;
    // +1 inside the log so a token in every candidate still weighs something,
    // and an unseen token (present only in the query) weighs the most.
    return Math.log(1 + total / (1 + seen));
  };
}

export interface MatchOptions {
  readonly threshold?: number;
  readonly tieMargin?: number;
}

/**
 * The best match for `name` among `items`, or `undefined`.
 *
 * `undefined` is a normal, frequent answer and is always better than a wrong
 * one: the geocoder's next rung down is city-level, which is honest.
 */
export function bestMatch<T extends Nameable>(
  name: string,
  items: readonly T[],
  options: MatchOptions = {},
): NameMatch<T> | undefined {
  const threshold = options.threshold ?? NAME_MATCH_THRESHOLD;
  const tieMargin = options.tieMargin ?? TIE_MARGIN;

  const queryKey = nameKey(name);
  if (queryKey.length === 0) {
    return undefined;
  }

  // Stage 1 — exact, on the normalized key or any alias. Nothing to score.
  const exact: NameMatch<T>[] = [];
  for (const item of items) {
    if (nameKey(item.name) === queryKey) {
      exact.push({ item, score: 1, via: 'EXACT' });
      continue;
    }
    if ((item.aliases ?? []).some((alias) => nameKey(alias) === queryKey)) {
      exact.push({ item, score: 1, via: 'ALIAS' });
    }
  }
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    // Several things claim the same exact name. Population breaks it only when
    // one is clearly larger; otherwise this is ambiguity, and R55 says fall back.
    return byPopulation(exact);
  }

  // Stage 2 — weighted token overlap.
  const weightOf = tokenWeights(items);
  const queryTokens = nameTokens(name);
  const scored = items
    .map((item) => ({
      item,
      score: Math.max(
        tokenSetScore(queryTokens, nameTokens(item.name), weightOf),
        ...(item.aliases ?? []).map((alias) =>
          tokenSetScore(queryTokens, nameTokens(alias), weightOf),
        ),
      ),
      via: 'TOKENS' as const,
    }))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best === undefined) {
    return undefined;
  }
  const runnerUp = scored[1];
  if (runnerUp !== undefined && best.score - runnerUp.score < tieMargin) {
    const resolved = byPopulation([best, runnerUp]);
    // Only a decisive population difference resolves a scoring tie.
    return resolved;
  }
  return best;
}

/**
 * Breaks a tie by population, and only when it is decisive (R55): the larger
 * must be at least twice the smaller, or the answer is "ambiguous".
 */
function byPopulation<T extends Nameable>(
  candidates: readonly NameMatch<T>[],
): NameMatch<T> | undefined {
  const ranked = [...candidates].sort(
    (a, b) => (b.item.population ?? 0) - (a.item.population ?? 0),
  );
  const first = ranked[0];
  const second = ranked[1];
  if (first === undefined) {
    return undefined;
  }
  if (second === undefined) {
    return first;
  }
  const bigger = first.item.population ?? 0;
  const smaller = second.item.population ?? 0;
  if (bigger === 0 || bigger < smaller * 2) {
    return undefined;
  }
  return first;
}
