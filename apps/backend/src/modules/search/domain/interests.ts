/**
 * Which categories a professor's interest tags point at (§8.4 "category/tag
 * overlap with user interests"). A tag and a category are the same interest
 * when their folded names agree: "AI/ML", "ai-ml" and "AI ML" are one thing.
 * A tag's aliases count too. Pure; the service reads the rows.
 */

export interface InterestTag {
  readonly id: string;
  readonly name: string;
  readonly normalized: string;
  readonly aliasesJson: string;
}

export interface NamedCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** Folded, punctuation as spaces, single-spaced. */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function aliasesOf(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Ids of the categories the tags name, in category order. */
export function interestCategoryIds(
  tags: readonly InterestTag[],
  categories: readonly NamedCategory[],
): string[] {
  const names = new Set(
    tags.flatMap((tag) => [tag.name, tag.normalized, ...aliasesOf(tag.aliasesJson)].map(foldName)),
  );
  names.delete('');
  return categories
    .filter((category) => names.has(foldName(category.name)) || names.has(foldName(category.slug)))
    .map((category) => category.id);
}
