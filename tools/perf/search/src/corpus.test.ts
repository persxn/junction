import { describe, expect, it } from 'vitest';

import { corpusHash, generateCorpus } from './corpus.js';
import { Prng } from './prng.js';

describe('the perf corpus is byte-identical on every run', () => {
  it('the PRNG is a pure function of its seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Prng(43).next()).not.toBe(first[0]);
  });

  it('the same seed gives the same corpus, a different one a different corpus', () => {
    expect(corpusHash(generateCorpus(500))).toBe(corpusHash(generateCorpus(500)));
    expect(corpusHash(generateCorpus(500, 1))).not.toBe(corpusHash(generateCorpus(500)));
  });

  it('pins the first 500 rows, so an accidental change to the generator is visible', () => {
    expect(corpusHash(generateCorpus(500))).toMatchInlineSnapshot(
      `"b853d08b5b6d970ab6c7c384e83a778b578baaaa38c69f1e8244ec6dceab5541"`,
    );
  });
});
