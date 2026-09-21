import type { Logger } from 'pino';

import { searchVocabulary, type VocabularyKind } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { AliasRow } from './domain/text.js';
import { wordTokens } from './domain/text.js';
import { correctWords, type CorrectionResult, type VocabularyEntry } from './domain/typo.js';
import type { SearchRepository } from './repo.js';

/**
 * The typo-tolerance vocabulary (§8.2, ruling F5/A5).
 *
 * `search_vocabulary` holds the distinct tokens of visible events' titles and
 * organizers plus every alias term, each with how many visible events carry it.
 * A query word with zero hits is matched against it by bounded edit distance
 * (`domain/typo.ts`). §8.2 also lists category names and tags; neither is
 * stored yet (categories arrive with WP-15b, tags have no table), and
 * {@link VocabularySources} is where they plug in.
 *
 * It is rebuilt wholesale — after each scrape run and URL import, after an
 * alias edit, and on demand — rather than maintained row by row. At 20 000
 * events the rebuild is tens of milliseconds, and a table that is recomputed
 * from scratch cannot drift.
 *
 * Nothing here talks to the trigram index. Substring matching is a different
 * mechanism (`domain/trigram.ts`), tested separately, and must stay so.
 */

/** Tokens shorter than this can never be a correction target (`maxEditsFor` < 4 → 0). */
const MIN_TERM_LENGTH = 2;

export interface VocabularySources {
  readonly aliases: () => readonly AliasRow[];
  /** Category names (WP-15b); empty until categories exist. */
  readonly categories?: () => readonly string[];
}

export interface VocabularyServiceDependencies {
  readonly db: DatabaseHandle;
  readonly repo: SearchRepository;
  readonly sources: VocabularySources;
  readonly logger?: Logger;
}

/** term → kind + document frequency, from the raw material. Pure; exported for tests. */
export function buildVocabulary(input: {
  readonly events: readonly { title: string; organizer: string | null }[];
  readonly aliases: readonly AliasRow[];
  readonly categories: readonly string[];
}): { term: string; kind: VocabularyKind; docFreq: number }[] {
  const entries = new Map<string, { kind: VocabularyKind; docFreq: number }>();
  const add = (term: string, kind: VocabularyKind, counted: boolean): void => {
    if ([...term].length < MIN_TERM_LENGTH) return;
    const found = entries.get(term);
    if (found === undefined) {
      entries.set(term, { kind, docFreq: counted ? 1 : 0 });
    } else if (counted) {
      found.docFreq += 1;
    }
  };
  for (const event of input.events) {
    const seen = new Set<string>();
    for (const [kind, text] of [
      ['TITLE', event.title],
      ['ORGANIZER', event.organizer ?? ''],
    ] as const) {
      for (const word of wordTokens(text)) {
        if (!seen.has(word)) {
          seen.add(word);
          add(word, kind, true);
        }
      }
    }
  }
  for (const name of input.categories) {
    for (const word of wordTokens(name)) add(word, 'CATEGORY', false);
  }
  for (const alias of input.aliases) {
    for (const phrase of [alias.term, ...alias.expansions]) {
      for (const word of wordTokens(phrase)) add(word, 'ALIAS', false);
    }
  }
  return [...entries.entries()]
    .map(([term, value]) => ({ term, kind: value.kind, docFreq: value.docFreq }))
    .sort((a, b) => (a.term < b.term ? -1 : 1));
}

export class VocabularyService {
  readonly #deps: VocabularyServiceDependencies;
  #cache: readonly VocabularyEntry[] | undefined;

  constructor(deps: VocabularyServiceDependencies) {
    this.#deps = deps;
  }

  /** Rebuilds `search_vocabulary` from what is stored now. Returns the term count. */
  refresh(): number {
    const started = performance.now();
    const entries = buildVocabulary({
      events: this.#deps.repo.vocabularySource(),
      aliases: this.#deps.sources.aliases(),
      categories: this.#deps.sources.categories?.() ?? [],
    });
    // One transaction: a reader never sees the table half-built.
    const { drizzle } = this.#deps.db;
    this.#deps.db.raw.transaction(() => {
      drizzle.delete(searchVocabulary).run();
      for (let at = 0; at < entries.length; at += 500) {
        drizzle
          .insert(searchVocabulary)
          .values(entries.slice(at, at + 500))
          .run();
      }
    })();
    this.#cache = entries.map((entry) => ({ term: entry.term, docFreq: entry.docFreq }));
    this.#deps.logger?.debug(
      { terms: entries.length, ms: Math.round(performance.now() - started) },
      'search vocabulary refreshed',
    );
    return entries.length;
  }

  /** The vocabulary, read from the table once and then kept in memory until the next refresh. */
  entries(): readonly VocabularyEntry[] {
    this.#cache ??= this.#deps.db.drizzle
      .select({ term: searchVocabulary.term, docFreq: searchVocabulary.docFreq })
      .from(searchVocabulary)
      .all();
    return this.#cache;
  }

  /** Corrects the zero-hit words of a query (see `correctWords`). */
  correct(
    words: readonly string[],
    protectedWords: ReadonlySet<string>,
    hasHits: (word: string) => boolean,
  ): CorrectionResult {
    return correctWords({ words, vocabulary: this.entries(), protectedWords, hasHits });
  }
}
