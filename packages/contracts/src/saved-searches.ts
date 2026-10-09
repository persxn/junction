import { z } from 'zod';

import { Uuid7 } from './ids.js';
import { EventQuery } from './search.js';

/**
 * Saved searches and "My interests" (§6.2, §8.1, §12, rulings R112–R113, WP-24).
 *
 * A saved search stores one `EventQuery` — the same object the chips build —
 * and is evaluated by the `saved-search-evaluator` job. R112: "new" is an event
 * id this search has never matched; creating a search, or changing its query,
 * records the current matches silently. A stored query that no longer parses
 * (the schema moved on) comes back with `query: null` and `invalidQuery: true`,
 * and is never evaluated.
 *
 * R113: interests are tags. A category interest is an INTEREST-kind tag whose
 * normalized name is the category's slug, so ranking (§8.4) reads them through
 * the one `user_interest_tags` join it already has.
 */

export const SAVED_SEARCH_NAME_MAX = 80;

const Name = z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX);

export const SavedSearch = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    /** Null only when `invalidQuery` is true. */
    query: EventQuery.nullable(),
    invalidQuery: z.boolean(),
    notifyOnNew: z.boolean(),
    lastEvaluatedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    version: z.int().min(1),
  })
  .strict();
export type SavedSearch = z.infer<typeof SavedSearch>;

export const SavedSearchList = z.object({ items: z.array(SavedSearch) }).strict();
export type SavedSearchList = z.infer<typeof SavedSearchList>;

/** `POST /saved-searches`. The query's cursor is never stored. */
export const SavedSearchCreate = z
  .object({
    name: Name,
    query: EventQuery,
    notifyOnNew: z.boolean().default(true),
  })
  .strict();
export type SavedSearchCreate = z.infer<typeof SavedSearchCreate>;
export type SavedSearchCreateInput = z.input<typeof SavedSearchCreate>;

/**
 * `PATCH /saved-searches/:id`. A new `query` re-baselines the search (R112):
 * whatever it matches now is recorded and nobody is told.
 */
export const SavedSearchPatch = z
  .object({
    version: z.int().min(1),
    name: Name.optional(),
    query: EventQuery.optional(),
    notifyOnNew: z.boolean().optional(),
  })
  .strict();
export type SavedSearchPatch = z.infer<typeof SavedSearchPatch>;
export type SavedSearchPatchInput = z.input<typeof SavedSearchPatch>;

/** `DELETE /saved-searches/:id?version=`. */
export const SavedSearchDeleteQuery = z
  .object({ version: z.coerce.number().int().min(1) })
  .strict();
export type SavedSearchDeleteQuery = z.infer<typeof SavedSearchDeleteQuery>;

/** `:id` in a saved-search route, or a category in `/me/interests/categories/:id`. */
export const SavedSearchIdParam = z.object({ id: Uuid7 }).strict();
export const InterestCategoryParam = z.object({ id: Uuid7 }).strict();

// ---- My interests (R113) -------------------------------------------------------

/** What a person is interested in: categories, and tags that are not categories. */
export const MyInterests = z
  .object({
    categoryIds: z.array(Uuid7),
    tagIds: z.array(Uuid7),
  })
  .strict();
export type MyInterests = z.infer<typeof MyInterests>;

export const InterestOption = z.object({ id: Uuid7, name: z.string().min(1) }).strict();
export type InterestOption = z.infer<typeof InterestOption>;

/** `GET /me/interests`: the ids, plus the words the dialog shows. */
export const MyInterestsView = MyInterests.extend({
  /** Every active category, in the admin's order: the checkbox list. */
  categoryOptions: z.array(InterestOption),
  /** The tags in `tagIds`, named. */
  tags: z.array(InterestOption),
}).strict();
export type MyInterestsView = z.infer<typeof MyInterestsView>;

/** A new interest typed in ("Add “Rust” as an interest"): becomes an INTEREST tag. */
export const INTEREST_TAG_NAME_MAX = 60;

/** `PUT /me/interests`: the whole intended set, like the drawer's category chips. */
export const MyInterestsUpdate = z
  .object({
    categoryIds: z.array(Uuid7).max(100),
    tagIds: z.array(Uuid7).max(100),
    newTagNames: z.array(z.string().trim().min(1).max(INTEREST_TAG_NAME_MAX)).max(20).optional(),
  })
  .strict();
export type MyInterestsUpdate = z.infer<typeof MyInterestsUpdate>;

/** `GET /me/interests/tag-options?text=`: existing TECHNOLOGY · THEME · SKILL tags. */
export const InterestTagQuery = z
  .object({ text: z.string().trim().max(INTEREST_TAG_NAME_MAX).default('') })
  .strict();
export type InterestTagQuery = z.infer<typeof InterestTagQuery>;

export const InterestTagOptions = z.object({ tags: z.array(InterestOption) }).strict();
export type InterestTagOptions = z.infer<typeof InterestTagOptions>;
