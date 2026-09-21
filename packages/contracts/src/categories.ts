import { z } from 'zod';

import { Uuid7 } from './ids.js';

/**
 * Categories and their deterministic rules (§6.2 Taxonomy, D-15, WP-15b).
 *
 * D-15: an event's categories come from its sources' tags and from rules an
 * administrator can read as a sentence; a professor's manual choice beats both,
 * always. AI classification (origin `AI`) is Phase 2 — the value exists so the
 * column never needs a migration, and nothing in the MVP writes it.
 */

export const CATEGORY_RULE_KINDS = [
  'KEYWORD',
  'PHRASE',
  'REGEX',
  'SOURCE_TAG',
  'EVENT_TYPE',
] as const;
export const CategoryRuleKind = z.enum(CATEGORY_RULE_KINDS);
export type CategoryRuleKind = z.infer<typeof CategoryRuleKind>;

/** Which text a KEYWORD/PHRASE/REGEX rule reads. SOURCE_TAG and EVENT_TYPE ignore it. */
export const CATEGORY_RULE_FIELDS = ['TITLE', 'DESCRIPTION', 'TAGS', 'ALL'] as const;
export const CategoryRuleField = z.enum(CATEGORY_RULE_FIELDS);
export type CategoryRuleField = z.infer<typeof CategoryRuleField>;

export const CATEGORY_ORIGINS = ['SOURCE_TAG', 'RULE', 'MANUAL', 'AI'] as const;
export const CategoryOrigin = z.enum(CATEGORY_ORIGINS);
export type CategoryOrigin = z.infer<typeof CategoryOrigin>;

/** Longest REGEX pattern accepted (the guard's first line). */
export const CATEGORY_RULE_PATTERN_MAX = 200;

const Slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'A slug is lower-case words joined by hyphens');

export const Category = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    slug: Slug,
    parentId: Uuid7.nullable(),
    description: z.string().nullable(),
    colorToken: z.string().min(1),
    icon: z.string().nullable(),
    sortOrder: z.int(),
    isActive: z.boolean(),
    /** Visible events carrying it (not suppressed). */
    eventCount: z.int().min(0),
  })
  .strict();
export type Category = z.infer<typeof Category>;

export const CategoryList = z.object({ items: z.array(Category) }).strict();
export type CategoryList = z.infer<typeof CategoryList>;

export const CategoryCreate = z
  .object({
    name: z.string().trim().min(1).max(60),
    slug: Slug,
    parentId: Uuid7.nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    colorToken: z.string().trim().min(1).max(40),
    icon: z.string().trim().min(1).max(40).nullable().optional(),
    sortOrder: z.int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type CategoryCreate = z.infer<typeof CategoryCreate>;

export const CategoryPatch = CategoryCreate.partial().strict();
export type CategoryPatch = z.infer<typeof CategoryPatch>;

export const CategoryRule = z
  .object({
    id: Uuid7,
    categoryId: Uuid7,
    kind: CategoryRuleKind,
    pattern: z.string().min(1),
    fields: CategoryRuleField,
    weight: z.int().min(0).max(100),
    isActive: z.boolean(),
  })
  .strict();
export type CategoryRule = z.infer<typeof CategoryRule>;

export const CategoryRuleList = z.object({ items: z.array(CategoryRule) }).strict();
export type CategoryRuleList = z.infer<typeof CategoryRuleList>;

/**
 * A rule as written. The shape is checked here; whether the pattern means
 * anything for its kind (a KEYWORD of one word, a known event type, a REGEX
 * that compiles and cannot backtrack without bound) is the backend's check,
 * answered `SEARCH_INVALID_RULE` / `SEARCH_RULE_PATTERN_UNSAFE`.
 */
export const CategoryRuleCreate = z
  .object({
    categoryId: Uuid7,
    kind: CategoryRuleKind,
    pattern: z.string().trim().min(1).max(CATEGORY_RULE_PATTERN_MAX),
    fields: CategoryRuleField.default('ALL'),
    weight: z.int().min(0).max(100),
    isActive: z.boolean().optional(),
  })
  .strict();
export type CategoryRuleCreate = z.infer<typeof CategoryRuleCreate>;
export type CategoryRuleCreateInput = z.input<typeof CategoryRuleCreate>;

export const CategoryRulePatch = z
  .object({
    categoryId: Uuid7.optional(),
    kind: CategoryRuleKind.optional(),
    pattern: z.string().trim().min(1).max(CATEGORY_RULE_PATTERN_MAX).optional(),
    fields: CategoryRuleField.optional(),
    weight: z.int().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type CategoryRulePatch = z.infer<typeof CategoryRulePatch>;

/** One row of `event_categories`, as the API shows it. */
export const CategoryAssignment = z
  .object({
    categoryId: Uuid7,
    origin: CategoryOrigin,
    ruleId: Uuid7.optional(),
    /** Normalized summed rule weight, 0–1; 1 for a manual assignment. */
    confidence: z.number().min(0).max(1),
    isSuppressed: z.boolean(),
  })
  .strict();
export type CategoryAssignment = z.infer<typeof CategoryAssignment>;

/** `POST /admin/category-rules/preview`: a rule not yet saved. */
export const CategoryRulePreviewRequest = z
  .object({
    kind: CategoryRuleKind,
    pattern: z.string().trim().min(1).max(CATEGORY_RULE_PATTERN_MAX),
    fields: CategoryRuleField.default('ALL'),
  })
  .strict();
export type CategoryRulePreviewRequest = z.infer<typeof CategoryRulePreviewRequest>;

/** A candidate rule's blast radius: the first events it would match. Nothing is written. */
export const CategoryRulePreview = z
  .object({
    items: z.array(
      z
        .object({
          id: Uuid7,
          title: z.string().min(1),
          /** The field the rule matched in (TITLE, DESCRIPTION, TAGS, or EVENT_TYPE). */
          matchedIn: z.string().min(1),
        })
        .strict(),
    ),
    /** How many visible events were checked. */
    scanned: z.int().min(0),
  })
  .strict();
export type CategoryRulePreview = z.infer<typeof CategoryRulePreview>;

export const CATEGORY_RULE_PREVIEW_MAX = 20;
