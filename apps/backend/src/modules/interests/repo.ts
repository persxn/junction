import type { DatabaseHandle } from '../../platform/db.js';
import type { InterestTag, NamedCategory } from '../search/domain/interests.js';

/**
 * Every statement "My interests" runs (R113). A person's interests are rows of
 * `user_interest_tags`, nothing else; category interests are INTEREST tags
 * whose normalized name is the category's slug.
 */

export interface HeldTag extends InterestTag {
  readonly kind: string;
}

/** The tag kinds a person may pick from as an interest (WP-24 step 7). */
const PICKABLE_KINDS = ['TECHNOLOGY', 'THEME', 'SKILL', 'INTEREST'] as const;
const OPTIONS_MAX = 20;

export class InterestsRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  transaction<T>(work: () => T): T {
    return this.#db.raw.transaction(work)();
  }

  activeCategories(): NamedCategory[] {
    return this.#db.raw
      .prepare(
        'SELECT id, name, slug FROM categories WHERE is_active = 1 ORDER BY sort_order, name',
      )
      .all() as NamedCategory[];
  }

  held(userId: string): HeldTag[] {
    return this.#db.raw
      .prepare(
        `SELECT t.id, t.kind, t.name, t.normalized, t.aliases_json AS aliasesJson
         FROM user_interest_tags u JOIN tags t ON t.id = u.tag_id
         WHERE u.user_id = ? ORDER BY t.name COLLATE NOCASE, t.id`,
      )
      .all(userId) as HeldTag[];
  }

  /** The tags among `ids` that exist; unknown ids are dropped. */
  tagsByIds(ids: readonly string[]): InterestTag[] {
    if (ids.length === 0) return [];
    return this.#db.raw
      .prepare(
        `SELECT id, name, normalized, aliases_json AS aliasesJson FROM tags
         WHERE id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(...ids) as InterestTag[];
  }

  /**
   * The INTEREST tag with this normalized name, created on first use — the
   * only way a category interest or a typed-in interest comes to exist (R113).
   */
  ensureInterestTag(name: string, normalized: string, id: string, at: number): string {
    this.#db.raw
      .prepare(
        `INSERT INTO tags (id, kind, name, normalized, aliases_json, created_at)
         VALUES (?, 'INTEREST', ?, ?, '[]', ?) ON CONFLICT (kind, normalized) DO NOTHING`,
      )
      .run(id, name, normalized, at);
    const row = this.#db.raw
      .prepare(`SELECT id FROM tags WHERE kind = 'INTEREST' AND normalized = ?`)
      .get(normalized) as { id: string };
    return row.id;
  }

  /** A tag of any pickable kind with this normalized name, INTEREST first. */
  findPickable(normalized: string): string | undefined {
    const row = this.#db.raw
      .prepare(
        `SELECT id FROM tags WHERE normalized = ? AND kind IN (${PICKABLE_KINDS.map(() => '?').join(', ')})
         ORDER BY kind = 'INTEREST' DESC, kind LIMIT 1`,
      )
      .get(normalized, ...PICKABLE_KINDS) as { id: string } | undefined;
    return row?.id;
  }

  /** Replaces the person's interests with `tagIds`. */
  replace(userId: string, tagIds: ReadonlySet<string>): void {
    this.#db.raw.prepare('DELETE FROM user_interest_tags WHERE user_id = ?').run(userId);
    const insert = this.#db.raw.prepare(
      'INSERT INTO user_interest_tags (user_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    );
    for (const tagId of tagIds) insert.run(userId, tagId);
  }

  /**
   * Existing tags to pick from, one per normalized name, matching `text`
   * anywhere in the name; `excluded` normalized names (the categories' slugs)
   * are left out — those are chosen as categories.
   */
  options(text: string, excluded: ReadonlySet<string>): InterestTag[] {
    const like = `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.#db.raw
      .prepare(
        `SELECT id, name, normalized, aliases_json AS aliasesJson FROM tags
         WHERE kind IN (${PICKABLE_KINDS.map(() => '?').join(', ')})
           AND (lower(name) LIKE ? ESCAPE '\\' OR normalized LIKE ? ESCAPE '\\')
         ORDER BY normalized, kind = 'INTEREST' DESC, kind, id`,
      )
      .all(...PICKABLE_KINDS, like, like) as InterestTag[];
    const seen = new Set<string>();
    const out: InterestTag[] = [];
    for (const row of rows) {
      if (seen.has(row.normalized) || excluded.has(row.normalized)) continue;
      seen.add(row.normalized);
      out.push(row);
      if (out.length === OPTIONS_MAX) break;
    }
    return out;
  }
}
