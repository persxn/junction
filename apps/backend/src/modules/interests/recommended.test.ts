import { SearchResponse, type SearchRequestInput } from '@compintel/contracts';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '../auth/types.js';
import { openRankingCorpus, type RankingCorpus } from '../../testing/ranking-corpus.js';
import { InterestsRepository } from './repo.js';
import { InterestsService } from './service.js';

/**
 * §19's M3 acceptance criterion, "reasons shown for every recommendation"
 * (WP-24), on the server side: Recommended — RELEVANCE, no text,
 * `excludeHidden`, the current user — pages through every result, and each
 * item carries at least one reason with text to show, for people with and
 * without interests. The UI half is `Recommended.test.tsx`.
 */

let corpus: RankingCorpus;
let interests: InterestsService;
let categoryIds: string[];
beforeAll(async () => {
  corpus = await openRankingCorpus();
  interests = new InterestsService({ repo: new InterestsRepository(corpus.h.database.db) });
  categoryIds = interests.view(corpus.professor).categoryOptions.map((option) => option.id);
});
afterAll(() => {
  corpus.h.close();
});

const RECOMMENDED: SearchRequestInput = { sort: 'RELEVANCE', excludeHidden: true, limit: 7 };

function everyPage(actor: Principal): SearchResponse['items'] {
  const items: SearchResponse['items'] = [];
  let body: SearchRequestInput = RECOMMENDED;
  for (;;) {
    const response = corpus.h.query({ ...body, facets: false }, actor);
    expect(SearchResponse.safeParse(response).success).toBe(true);
    items.push(...response.items);
    if (response.nextCursor === undefined) return items;
    body = { ...RECOMMENDED, cursor: response.nextCursor };
  }
}

describe('every recommendation shows its reasons', () => {
  it('for any set of interests, every item on every page has ≥ 1 reason with text', () => {
    fc.assert(
      fc.property(
        fc.subarray(categoryIds, { maxLength: 4 }),
        fc.subarray(['Rust', 'Design', 'Blockchain', 'jeopardy'], { maxLength: 2 }),
        (categories, tags) => {
          const actor = corpus.h.user('PROFESSOR');
          if (categories.length + tags.length > 0) {
            interests.replace(actor, { categoryIds: categories, tagIds: [], newTagNames: tags });
          }
          const items = everyPage(actor);
          expect(items.length).toBeGreaterThan(0);
          for (const item of items) {
            expect(item.reasons.length, item.title).toBeGreaterThanOrEqual(1);
            // What the card prints inline: the first two, joined.
            const inline = item.reasons
              .slice(0, 2)
              .map((reason) => reason.text)
              .join(' · ');
            expect(inline.trim().length, item.title).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 25, seed: 24 },
    );
  });

  it('an interest puts its reason on the card that matches it', () => {
    const actor = corpus.h.user('PROFESSOR');
    const ai = interests.view(actor).categoryOptions.find((option) => option.name.startsWith('AI'));
    expect(ai).toBeDefined();
    interests.addCategory(actor, ai?.id ?? '');
    const reasons = everyPage(actor).flatMap((item) => item.reasons.map((reason) => reason.text));
    expect(reasons).toContain(`${ai?.name ?? ''} matches your interests`);
  });
});
