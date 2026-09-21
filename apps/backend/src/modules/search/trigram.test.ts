import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSearchHarness, type SearchHarness } from '../../testing/search.js';
import { trigramChunks, trigramMatchExpression } from './domain/trigram.js';

/**
 * Substring matching over title + organizer (§8.2, ruling F5/A5). Trigram is
 * *only* this; typo tolerance is `typo.test.ts`, and nothing here asserts on a
 * correction except to prove none was needed.
 */

describe('the trigram expression', () => {
  it('quotes each whitespace fragment verbatim and ANDs them', () => {
    expect(trigramChunks('  C++   ackath ')).toEqual(['C++', 'ackath']);
    expect(trigramMatchExpression('ackath iit')).toBe('"ackath" AND "iit"');
    expect(trigramMatchExpression('hack"athon')).toBe('"hack""athon"');
  });

  it('has no expression when any fragment is under three characters', () => {
    expect(trigramMatchExpression('ha')).toBeUndefined();
    expect(trigramMatchExpression('ml ackath')).toBeUndefined();
    expect(trigramMatchExpression('')).toBeUndefined();
  });
});

describe('substring search', () => {
  let h: SearchHarness;

  beforeEach(() => {
    h = openSearchHarness();
    h.add({ title: 'Smart India Hackathon', organizerName: 'AICTE' });
    h.add({ title: 'Robotics League', organizerName: 'Café Robotique' });
    // "ckath" occurs inside a description word only: substring search must not see it.
    h.add({ title: 'Quiet Event', descriptionMd: 'notes on the great hackathlon' });
  });

  afterEach(() => {
    h.close();
  });

  it('"ackath" (a substring, not a prefix) finds "Hackathon"', () => {
    const response = h.query({ text: 'ackath' });
    expect(response.items.map((item) => item.title)).toEqual(['Smart India Hackathon']);
    expect(response.correction).toBeUndefined();
  });

  it('a 2-character fragment finds nothing by substring', () => {
    expect(h.titles({ text: 'ck' })).toEqual([]);
  });

  it('matches the organizer too, folding case and diacritics', () => {
    expect(h.titles({ text: 'OBOTIQ' })).toEqual(['Robotics League']);
    expect(h.titles({ text: 'cafe' })).toEqual(['Robotics League']);
  });

  it('is limited to title and organizer — a description substring is not a hit', () => {
    expect(h.titles({ text: 'ckath' })).toEqual(['Smart India Hackathon']);
  });

  it('ranks a word hit ahead of a substring-only hit', () => {
    h.add({ title: 'Hack Night' });
    h.add({ title: 'Hackers United' });
    // "hack" is a word in "Hack Night" and only a substring of "Hackers"/"Hackathon".
    expect(h.titles({ text: 'hack' })[0]).toBe('Hack Night');
  });
});
