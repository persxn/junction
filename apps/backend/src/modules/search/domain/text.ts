/**
 * Query text → an FTS5 MATCH expression (§8.2).
 *
 * Two rules carry the weight here.
 *
 * **User text never reaches FTS5 as syntax.** Every word becomes a quoted
 * string, and a quoted string in FTS5 is a phrase of literal tokens: `OR`,
 * `NEAR(`, `*`, `^` and a stray `"` are searched for (or tokenized away), never
 * obeyed. Words are also cut on anything that is not a letter or a digit, so a
 * double quote cannot even arrive inside one; {@link quoteFts} doubles it anyway,
 * because an escaper that is only correct when its input is pre-cleaned is one
 * refactor from an injection.
 *
 * **Aliases are groups, not arrows.** §6.2 stores `ml → ["machine learning"]`,
 * and a professor who types either spelling expects the other to match. So the
 * stored rows are folded into groups of equivalent phrases, and a query word or
 * phrase that belongs to a group becomes an OR over the whole group.
 */

/** Case-folded, diacritics removed — what `unicode61 remove_diacritics 2` does to a token. */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

const WORD = /[\p{L}\p{N}]+/gu;

/** The words of a query, as the FTS tokenizer would see them. */
export function wordTokens(text: string): string[] {
  return foldText(text).match(WORD) ?? [];
}

/** True for a word made only of letters — the only kind a typo correction may touch. */
export function isAlphabetic(word: string): boolean {
  return /^\p{L}+$/u.test(word);
}

/** An FTS5 string literal: double quotes around, embedded quotes doubled. */
export function quoteFts(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

export interface AliasRow {
  readonly term: string;
  readonly expansions: readonly string[];
}

export interface AliasIndex {
  /** Each group's members as folded phrases (`"machine learning"`), sorted. */
  readonly groups: readonly (readonly string[])[];
  /** Folded phrase → index into `groups`. */
  readonly byPhrase: ReadonlyMap<string, number>;
  /** The longest member, in words; bounds the n-gram scan. */
  readonly maxWords: number;
}

function phraseOf(text: string): string {
  return wordTokens(text).join(' ');
}

/**
 * Folds alias rows into groups. A phrase that appears in two rows joins their
 * groups (`genai → generative ai`, `gen ai → generative ai` is one group of
 * three), so expansion is transitive and the order rows were stored in cannot
 * change a result.
 */
export function buildAliasIndex(rows: readonly AliasRow[]): AliasIndex {
  const parent = new Map<string, string>();
  const find = (phrase: string): string => {
    let root = phrase;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    parent.set(phrase, root);
    return root;
  };
  const add = (phrase: string): void => {
    if (!parent.has(phrase)) {
      parent.set(phrase, phrase);
    }
  };
  for (const row of rows) {
    const term = phraseOf(row.term);
    if (term === '') {
      continue;
    }
    add(term);
    for (const expansion of row.expansions) {
      const phrase = phraseOf(expansion);
      if (phrase === '') {
        continue;
      }
      add(phrase);
      const a = find(term);
      const b = find(phrase);
      if (a !== b) {
        parent.set(a < b ? b : a, a < b ? a : b);
      }
    }
  }

  const members = new Map<string, string[]>();
  for (const phrase of parent.keys()) {
    const root = find(phrase);
    members.set(root, [...(members.get(root) ?? []), phrase]);
  }
  const groups = [...members.values()]
    .map((group) => [...group].sort())
    .sort((a, b) => ((a[0] ?? '') < (b[0] ?? '') ? -1 : 1));
  const byPhrase = new Map<string, number>();
  let maxWords = 0;
  groups.forEach((group, index) => {
    for (const phrase of group) {
      byPhrase.set(phrase, index);
      maxWords = Math.max(maxWords, phrase.split(' ').length);
    }
  });
  return { groups, byPhrase, maxWords };
}

export const EMPTY_ALIAS_INDEX: AliasIndex = buildAliasIndex([]);

/** One AND-ed unit of a text query. */
export type TextTerm =
  | { readonly kind: 'WORD'; readonly word: string }
  | { readonly kind: 'ALIAS'; readonly matched: string; readonly phrases: readonly string[] };

/**
 * Replaces the longest alias phrase starting at each position with its group,
 * scanning left to right. "ml hackathon" → [ALIAS(ml | machine learning),
 * WORD(hackathon)]; "machine learning" → one ALIAS term, not two words.
 */
export function expandAliases(words: readonly string[], index: AliasIndex): TextTerm[] {
  const terms: TextTerm[] = [];
  let position = 0;
  while (position < words.length) {
    let matched: { phrase: string; group: number; length: number } | undefined;
    const longest = Math.min(index.maxWords, words.length - position);
    for (let length = longest; length >= 1 && matched === undefined; length -= 1) {
      const phrase = words.slice(position, position + length).join(' ');
      const group = index.byPhrase.get(phrase);
      if (group !== undefined) {
        matched = { phrase, group, length };
      }
    }
    if (matched === undefined) {
      terms.push({ kind: 'WORD', word: words[position] ?? '' });
      position += 1;
    } else {
      terms.push({
        kind: 'ALIAS',
        matched: matched.phrase,
        phrases: index.groups[matched.group] ?? [matched.phrase],
      });
      position += matched.length;
    }
  }
  return terms;
}

/** The words an alias expansion claimed — they are never typo-corrected. */
export function aliasWords(terms: readonly TextTerm[]): Set<string> {
  const words = new Set<string>();
  for (const term of terms) {
    if (term.kind === 'ALIAS') {
      for (const word of term.matched.split(' ')) {
        words.add(word);
      }
    }
  }
  return words;
}

/**
 * The MATCH expression for `event_fts`: every term AND-ed, an alias as an
 * OR-group of quoted phrases. `undefined` when the text held no word at all
 * (`"*"`, `"--"`), which the caller treats as "matches nothing", never as an
 * error and never as "no text filter".
 */
export function ftsMatchExpression(terms: readonly TextTerm[]): string | undefined {
  if (terms.length === 0) {
    return undefined;
  }
  return terms
    .map((term) =>
      term.kind === 'WORD'
        ? quoteFts(term.word)
        : `(${term.phrases.map((phrase) => quoteFts(phrase)).join(' OR ')})`,
    )
    .join(' AND ');
}
