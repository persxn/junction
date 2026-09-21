import { describe, expect, it } from 'vitest';

import {
  aliasWords,
  buildAliasIndex,
  EMPTY_ALIAS_INDEX,
  expandAliases,
  foldText,
  ftsMatchExpression,
  quoteFts,
  wordTokens,
} from './text.js';

const SEED = [
  { term: 'ml', expansions: ['machine learning'] },
  { term: 'genai', expansions: ['generative ai'] },
  { term: 'ctf', expansions: ['capture the flag'] },
];

describe('tokenizing like unicode61', () => {
  it('folds case and removes diacritics', () => {
    expect(foldText('Café DÉJÀ Vu')).toBe('cafe deja vu');
    expect(wordTokens('Café-Hackathon 2026!')).toEqual(['cafe', 'hackathon', '2026']);
  });

  it('drops everything that is not a letter or digit', () => {
    expect(wordTokens('"*" NEAR( ^ --')).toEqual(['near']);
    expect(wordTokens('***')).toEqual([]);
  });
});

describe('escaping (no FTS syntax injection)', () => {
  it('quotes every term and doubles embedded quotes', () => {
    expect(quoteFts('or')).toBe('"or"');
    expect(quoteFts('a"b')).toBe('"a""b"');
  });

  it('an operator word becomes a quoted literal, AND-ed', () => {
    expect(
      ftsMatchExpression(expandAliases(wordTokens('hack OR NOT near'), EMPTY_ALIAS_INDEX)),
    ).toBe('"hack" AND "or" AND "not" AND "near"');
  });

  it('text with no word at all has no expression', () => {
    expect(ftsMatchExpression(expandAliases(wordTokens('"*"'), EMPTY_ALIAS_INDEX))).toBeUndefined();
  });
});

describe('aliases are two-way groups', () => {
  const index = buildAliasIndex(SEED);

  it('the short form expands to the long one', () => {
    expect(ftsMatchExpression(expandAliases(['ml', 'hackathon'], index))).toBe(
      '("machine learning" OR "ml") AND "hackathon"',
    );
  });

  it('the long form (a phrase) expands to the short one', () => {
    const terms = expandAliases(['machine', 'learning', 'challenge'], index);
    expect(terms[0]).toEqual({
      kind: 'ALIAS',
      matched: 'machine learning',
      phrases: ['machine learning', 'ml'],
    });
    expect(aliasWords(terms)).toEqual(new Set(['machine', 'learning']));
  });

  it('rows sharing a phrase merge into one group, whatever their order', () => {
    const rows = [...SEED, { term: 'gen ai', expansions: ['Generative AI'] }];
    const forward = buildAliasIndex(rows);
    const backward = buildAliasIndex([...rows].reverse());
    expect(forward.groups).toEqual(backward.groups);
    expect(forward.groups).toContainEqual(['gen ai', 'genai', 'generative ai']);
  });

  it('a word that only starts an alias phrase stays a word', () => {
    expect(expandAliases(['machine', 'vision'], index)).toEqual([
      { kind: 'WORD', word: 'machine' },
      { kind: 'WORD', word: 'vision' },
    ]);
  });
});
