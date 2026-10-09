import type { InterestTagOptions, MyInterestsUpdate, MyInterestsView } from '@compintel/contracts';

import { AppError } from '../../platform/errors.js';
import { uuid7, type Uuid7Generator } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { normalizeTag } from '../categories/domain/text.js';
import { interestCategoryIds, type NamedCategory } from '../search/domain/interests.js';
import type { HeldTag, InterestsRepository } from './repo.js';

/**
 * "My interests" (§8.4, R113, D-18, WP-24). Interests are tags: a category
 * interest is an INTEREST tag whose normalized name is the category's slug,
 * so ranking finds it through the same `user_interest_tags` join and the same
 * name-matching rule (`interestCategoryIds`) it already uses. Personal and
 * not audited; they change ranking for their owner only.
 */

const categoryNotFound = (): AppError =>
  new AppError({
    code: 'NOT_FOUND',
    status: 404,
    title: 'No such category',
    detail: 'That category does not exist or is no longer active.',
    retryable: false,
  });

export class InterestsService {
  readonly #repo: InterestsRepository;
  readonly #clock: Clock;
  readonly #ids: Uuid7Generator;

  constructor(deps: { repo: InterestsRepository; clock?: Clock; ids?: Uuid7Generator }) {
    this.#repo = deps.repo;
    this.#clock = deps.clock ?? systemClock;
    this.#ids = deps.ids ?? uuid7;
  }

  view(actor: Principal): MyInterestsView {
    assertCan(actor, 'event.view');
    const categories = this.#repo.activeCategories();
    const held = this.#repo.held(actor.id);
    const split = splitHeld(held, categories);
    return {
      categoryIds: split.categoryIds,
      tagIds: split.plain.map((tag) => tag.id),
      categoryOptions: categories.map((category) => ({ id: category.id, name: category.name })),
      tags: split.plain.map((tag) => ({ id: tag.id, name: tag.name })),
    };
  }

  /** The whole intended set (like the drawer's category chips): what is not named is removed. */
  replace(actor: Principal, update: MyInterestsUpdate): MyInterestsView {
    assertCan(actor, 'event.view');
    const categories = this.#repo.activeCategories();
    const byId = new Map(categories.map((category) => [category.id, category]));
    for (const id of update.categoryIds) if (!byId.has(id)) throw categoryNotFound();
    const at = nowMs(this.#clock);
    this.#repo.transaction(() => {
      const wanted = new Set<string>();
      for (const id of new Set(update.categoryIds)) {
        const category = byId.get(id) as NamedCategory;
        wanted.add(this.#repo.ensureInterestTag(category.name, category.slug, this.#ids(), at));
      }
      // A picked tag that names a category *is* that category (the ranking's own
      // rule): it stays only while that category is chosen.
      const chosen = new Set(update.categoryIds);
      for (const tag of this.#repo.tagsByIds(update.tagIds)) {
        const named = interestCategoryIds([tag], categories);
        if (named.length === 0 || named.some((id) => chosen.has(id))) wanted.add(tag.id);
      }
      for (const name of update.newTagNames ?? []) {
        const normalized = normalizeTag(name);
        if (normalized === '') continue;
        wanted.add(
          this.#repo.findPickable(normalized) ??
            this.#repo.ensureInterestTag(name.trim(), normalized, this.#ids(), at),
        );
      }
      this.#repo.replace(actor.id, wanted);
    });
    return this.view(actor);
  }

  addCategory(actor: Principal, categoryId: string): MyInterestsView {
    const current = this.view(actor);
    if (!current.categoryOptions.some((option) => option.id === categoryId)) {
      throw categoryNotFound();
    }
    if (current.categoryIds.includes(categoryId)) return current;
    return this.replace(actor, {
      categoryIds: [...current.categoryIds, categoryId],
      tagIds: current.tagIds,
    });
  }

  removeCategory(actor: Principal, categoryId: string): MyInterestsView {
    const current = this.view(actor);
    if (!current.categoryIds.includes(categoryId)) return current;
    return this.replace(actor, {
      categoryIds: current.categoryIds.filter((id) => id !== categoryId),
      tagIds: current.tagIds,
    });
  }

  /** Existing TECHNOLOGY · THEME · SKILL (and earlier INTEREST) tags matching `text`. */
  tagOptions(actor: Principal, text: string): InterestTagOptions {
    assertCan(actor, 'event.view');
    const slugs = new Set(this.#repo.activeCategories().map((category) => category.slug));
    const tags = this.#repo.options(text.trim(), slugs);
    return { tags: tags.map((tag) => ({ id: tag.id, name: tag.name })) };
  }
}

/** Held tags → the categories they name, and the tags that name none. */
function splitHeld(
  held: readonly HeldTag[],
  categories: readonly NamedCategory[],
): { categoryIds: string[]; plain: HeldTag[] } {
  const categoryIds = interestCategoryIds(held, categories);
  const plain = held.filter((tag) => interestCategoryIds([tag], categories).length === 0);
  return { categoryIds, plain };
}
