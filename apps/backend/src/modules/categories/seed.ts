import { readFileSync } from 'node:fs';

import { CategoryRuleField, CategoryRuleKind } from '@compintel/contracts';
import { z } from 'zod';

import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import { validateRulePattern } from './domain/classify.js';

/**
 * The starter taxonomy (WP-15b step 2): `resources/category-rules.seed.json`,
 * applied once per seed `version`.
 *
 * Idempotent in both directions that matter: running it twice changes nothing,
 * and it never overwrites an administrator. A version bump only **adds**
 * categories (by slug) and rules (by category, kind and pattern) that are not
 * there; it does not re-add what an administrator deleted under the same
 * version, and it does not touch a renamed or re-weighted row.
 */

export const CATEGORY_SEED_META_KEY = 'category_seed_version';

const SeedRule = z
  .object({
    kind: CategoryRuleKind,
    pattern: z.string().min(1).max(200),
    fields: CategoryRuleField.default('ALL'),
    weight: z.int().min(0).max(100),
  })
  .strict();

export const CategorySeed = z
  .object({
    $comment: z.string().optional(),
    version: z.int().min(1),
    categories: z.array(
      z
        .object({
          slug: z.string().min(1),
          name: z.string().min(1),
          colorToken: z.string().min(1),
          icon: z.string().min(1).optional(),
          description: z.string().optional(),
          rules: z.array(SeedRule),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((seed, context) => {
    seed.categories.forEach((category, index) => {
      category.rules.forEach((rule, ruleIndex) => {
        const problem = validateRulePattern(rule.kind, rule.pattern);
        if (problem !== undefined) {
          context.addIssue({
            code: 'custom',
            path: ['categories', index, 'rules', ruleIndex, 'pattern'],
            message: problem.message,
          });
        }
      });
    });
  });
export type CategorySeed = z.infer<typeof CategorySeed>;

export function loadCategorySeed(file: string): CategorySeed {
  return CategorySeed.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface SeedResult {
  readonly applied: boolean;
  readonly categoriesAdded: number;
  readonly rulesAdded: number;
}

export function applyCategorySeed(db: DatabaseHandle, seed: CategorySeed, at: number): SeedResult {
  const raw = db.raw;
  const stored = raw
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get(CATEGORY_SEED_META_KEY) as { value: string } | undefined;
  if (stored !== undefined && Number(stored.value) >= seed.version) {
    return { applied: false, categoriesAdded: 0, rulesAdded: 0 };
  }
  let categoriesAdded = 0;
  let rulesAdded = 0;
  raw.transaction(() => {
    seed.categories.forEach((category, index) => {
      let row = raw.prepare('SELECT id FROM categories WHERE slug = ?').get(category.slug) as
        { id: string } | undefined;
      if (row === undefined) {
        row = { id: uuid7() };
        raw
          .prepare(
            `INSERT INTO categories (id, name, slug, description, color_token, icon, sort_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            row.id,
            category.name,
            category.slug,
            category.description ?? null,
            category.colorToken,
            category.icon ?? null,
            (index + 1) * 10,
            at,
            at,
          );
        categoriesAdded += 1;
      }
      for (const rule of category.rules) {
        const exists = raw
          .prepare(
            'SELECT 1 FROM category_rules WHERE category_id = ? AND kind = ? AND pattern = ?',
          )
          .get(row.id, rule.kind, rule.pattern);
        if (exists !== undefined) continue;
        raw
          .prepare(
            `INSERT INTO category_rules (id, category_id, kind, pattern, fields, weight, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(uuid7(), row.id, rule.kind, rule.pattern, rule.fields, rule.weight, at, at);
        rulesAdded += 1;
      }
    });
    raw
      .prepare(
        `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(CATEGORY_SEED_META_KEY, String(seed.version), at);
  })();
  return { applied: true, categoriesAdded, rulesAdded };
}
