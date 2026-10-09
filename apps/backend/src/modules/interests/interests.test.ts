import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSearchHarness, type SearchHarness } from '../../testing/search.js';
import { InterestsRepository } from './repo.js';
import { InterestsService } from './service.js';

/**
 * R113 over the starter taxonomy (WP-24): a category interest is one INTEREST
 * tag named by the category's slug, created once; ranking's CATEGORY_MATCH
 * then fires for its owner only, and stops when it is removed.
 */

let h: SearchHarness;
let service: InterestsService;
beforeEach(async () => {
  h = openSearchHarness();
  h.seedCategories();
  h.add({ title: 'Generative AI Hackathon', eventType: 'HACKATHON' });
  h.add({ title: 'Robotics Summit', eventType: 'OTHER' });
  await h.classifyAll();
  service = new InterestsService({ repo: new InterestsRepository(h.database.db), clock: h.clock });
});
afterEach(() => {
  h.close();
});

const aiMl = (): { id: string; name: string } => {
  const row = h.database.db.raw
    .prepare("SELECT id, name FROM categories WHERE slug = 'ai-ml'")
    .get() as { id: string; name: string };
  return row;
};
const interestTags = (): { name: string; normalized: string }[] =>
  h.database.db.raw
    .prepare("SELECT name, normalized FROM tags WHERE kind = 'INTEREST' ORDER BY normalized")
    .all() as { name: string; normalized: string }[];
const reasonsOf = (title: string, actor = professor()) =>
  h.query({ sort: 'RELEVANCE' }, actor).items.find((item) => item.title === title)?.reasons ?? [];
let cachedProfessor: ReturnType<SearchHarness['user']> | undefined;
const professor = () => (cachedProfessor ??= h.user('PROFESSOR'));
beforeEach(() => {
  cachedProfessor = undefined;
});

describe('category interests are tags (R113)', () => {
  it('choosing a category makes one INTEREST tag named by its slug — twice, still one', () => {
    const category = aiMl();
    const me = professor();
    const view = service.addCategory(me, category.id);
    expect(view.categoryIds).toStrictEqual([category.id]);
    expect(view.tagIds).toStrictEqual([]);
    service.addCategory(me, category.id);
    service.addCategory(h.user('PROFESSOR'), category.id);
    expect(interestTags()).toStrictEqual([{ name: category.name, normalized: 'ai-ml' }]);
  });

  it('then fires the category-interest reason on an event of that category, and stops when removed', () => {
    const category = aiMl();
    const me = professor();
    const before = reasonsOf('Generative AI Hackathon', me).map((reason) => reason.code);
    expect(before).not.toContain('CATEGORY_MATCH');
    service.addCategory(me, category.id);
    const reasons = reasonsOf('Generative AI Hackathon', me);
    expect(reasons.find((reason) => reason.code === 'CATEGORY_MATCH')?.text).toBe(
      `${category.name} matches your interests`,
    );
    // Personal: another professor's ranking is untouched.
    expect(
      reasonsOf('Generative AI Hackathon', h.user('PROFESSOR')).map((reason) => reason.code),
    ).not.toContain('CATEGORY_MATCH');
    service.removeCategory(me, category.id);
    expect(reasonsOf('Generative AI Hackathon', me).map((reason) => reason.code)).not.toContain(
      'CATEGORY_MATCH',
    );
  });

  it('a typed-in interest reuses an existing tag of that name, else becomes an INTEREST tag', () => {
    const me = professor();
    const theme = h.database.db.raw
      .prepare(
        "INSERT INTO tags (id, kind, name, normalized, created_at) VALUES ('01931f2a-0000-7000-8000-0000000000aa', 'THEME', 'Quantum Computing', 'quantum computing', 0) RETURNING id",
      )
      .get() as { id: string };
    const view = service.replace(me, {
      categoryIds: [],
      tagIds: [],
      newTagNames: ['quantum  computing', 'Rust'],
    });
    expect(view.tags.map((tag) => tag.name).sort()).toStrictEqual(['Quantum Computing', 'Rust']);
    expect(view.tagIds).toContain(theme.id);
    expect(interestTags()).toStrictEqual([{ name: 'Rust', normalized: 'rust' }]);
  });

  it('the whole-set PUT removes what it does not name; tag options leave categories out', () => {
    const me = professor();
    const category = aiMl();
    service.replace(me, { categoryIds: [category.id], tagIds: [], newTagNames: ['Rust'] });
    const cleared = service.replace(me, { categoryIds: [], tagIds: [] });
    expect(cleared.categoryIds).toStrictEqual([]);
    expect(cleared.tagIds).toStrictEqual([]);
    const options = service.tagOptions(me, '');
    expect(options.tags.map((tag) => tag.name)).toContain('Rust');
    expect(options.tags.map((tag) => tag.name)).not.toContain(category.name);
  });
});
