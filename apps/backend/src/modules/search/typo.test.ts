import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSearchHarness, type SearchHarness } from '../../testing/search.js';
import { bestCorrection, boundedDistance, correctWords, maxEditsFor } from './domain/typo.js';
import { buildVocabulary } from './vocabulary.js';

/**
 * Typo tolerance (§8.2, ruling F5/A5): vocabulary + bounded edit distance.
 *
 * This file and `trigram.test.ts` are separate on purpose. Nothing here relies
 * on the trigram index, and a test that passed *because* a substring happened
 * to match would prove the wrong mechanism.
 */

describe('edit distance and allowance', () => {
  it('allows 0 edits under 4 letters, 1 for 4–5, 2 for 6+', () => {
    expect([1, 3, 4, 5, 6, 12].map(maxEditsFor)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('counts an adjacent transposition as one edit', () => {
    expect(boundedDistance('secuirty', 'security', 2)).toBe(1);
    expect(boundedDistance('hackthon', 'hackathon', 2)).toBe(1);
    expect(boundedDistance('kitten', 'sitting', 5)).toBe(3);
  });

  it('stops early and reports max + 1 beyond the bound', () => {
    expect(boundedDistance('robotics', 'hackathon', 2)).toBe(3);
    expect(boundedDistance('ab', 'abcdef', 1)).toBe(2);
  });

  it('picks the closest term, then the most common, then alphabetical', () => {
    const vocabulary = [
      { term: 'hackathons', docFreq: 50 },
      { term: 'hackathon', docFreq: 3 },
      { term: 'hackaton', docFreq: 99 },
    ];
    // "hackathn": hackathon 1 edit, hackaton 1 edit (freq 99 wins), hackathons 2.
    expect(bestCorrection('hackathn', vocabulary)?.term).toBe('hackaton');
    expect(bestCorrection('abc', vocabulary)).toBeUndefined();
  });

  it('prefers joining a split compound on a tie', () => {
    const result = correctWords({
      words: ['cyber', 'secuirty'],
      vocabulary: [
        { term: 'security', docFreq: 10 },
        { term: 'cybersecurity', docFreq: 1 },
      ],
      protectedWords: new Set(),
      hasHits: (word) => word === 'cyber',
    });
    expect(result).toEqual({ words: ['cybersecurity'], corrected: true });
  });

  it('never touches alias words, numbers or hit words', () => {
    const result = correctWords({
      words: ['genai', 'hackathon2026', 'robotcs'],
      vocabulary: [
        { term: 'gemini', docFreq: 1 },
        { term: 'robotics', docFreq: 1 },
      ],
      protectedWords: new Set(['genai']),
      hasHits: (word) => word === 'robotcs',
    });
    expect(result.corrected).toBe(false);
  });

  it('builds document frequencies per event, not per occurrence', () => {
    const entries = buildVocabulary({
      events: [
        { title: 'Hackathon Hackathon', organizer: 'IIT Madras' },
        { title: 'Winter Hackathon', organizer: null },
      ],
      aliases: [{ term: 'ml', expansions: ['machine learning'] }],
      categories: [],
    });
    expect(entries.find((entry) => entry.term === 'hackathon')).toEqual({
      term: 'hackathon',
      kind: 'TITLE',
      docFreq: 2,
    });
    expect(entries.find((entry) => entry.term === 'learning')?.kind).toBe('ALIAS');
  });
});

describe('the §8.2 acceptance criterion, end to end', () => {
  let h: SearchHarness;

  beforeEach(() => {
    h = openSearchHarness();
    h.add({ title: 'Smart India Hackathon 2026', organizerName: 'AICTE' });
    h.add({ title: 'Winter Hackathon', organizerName: 'IIT Madras' });
    h.add({ title: 'Cybersecurity Challenge', organizerName: 'CERT-In', eventType: 'CTF' });
    h.add({ title: 'Robotics League', organizerName: 'NIT Trichy' });
  });

  afterEach(() => {
    h.close();
  });

  it('"hackthon" → hackathon, reported', () => {
    const response = h.query({ text: 'hackthon' });
    expect(response.items.map((item) => item.title).sort()).toEqual([
      'Smart India Hackathon 2026',
      'Winter Hackathon',
    ]);
    expect(response.correction).toEqual({
      searchedTerm: 'hackthon',
      usedTerm: 'hackathon',
      message: 'Showing results for hackathon (searched hackthon)',
    });
  });

  it('"cyber secuirty" → cybersecurity, reported', () => {
    const response = h.query({ text: 'cyber secuirty' });
    expect(response.items.map((item) => item.title)).toEqual(['Cybersecurity Challenge']);
    expect(response.correction).toEqual({
      searchedTerm: 'cyber secuirty',
      usedTerm: 'cybersecurity',
      message: 'Showing results for cybersecurity (searched cyber secuirty)',
    });
  });

  it('a word that does hit is never corrected', () => {
    h.add({ title: 'Hackaton Nights' }); // a real (if odd) spelling in a title
    const response = h.query({ text: 'hackaton' });
    expect(response.items.map((item) => item.title)).toEqual(['Hackaton Nights']);
    expect(response.correction).toBeUndefined();
  });

  it('a 3-letter typo is not corrected', () => {
    h.add({ title: 'AI Summit' });
    const response = h.query({ text: 'aj' });
    expect(response.items).toEqual([]);
    expect(response.correction).toBeUndefined();
    expect(h.query({ text: 'sumit' }).correction?.usedTerm).toBe('summit');
    expect(h.query({ text: 'rbt' }).correction).toBeUndefined();
  });

  it('a word only a hidden event carries is still corrected towards visible ones', () => {
    h.add({ title: 'Hackthon Private', visibility: 'ADMIN_HIDDEN' });
    const response = h.query({ text: 'hackthon' });
    expect(response.correction?.usedTerm).toBe('hackathon');
    expect(response.items.map((item) => item.title)).not.toContain('Hackthon Private');
  });

  it('the vocabulary follows ingest: a new title becomes a correction target', () => {
    expect(h.query({ text: 'ideathonn' }).correction).toBeUndefined();
    h.add({ title: 'National Ideathon' });
    expect(h.query({ text: 'ideathonn' }).correction?.usedTerm).toBe('ideathon');
  });
});
