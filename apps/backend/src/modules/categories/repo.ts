import type { Category, CategoryRule, EventType } from '@compintel/contracts';

import type { CategoryRow, CategoryRuleRow } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import type { ClassifierRule, ComputedAssignment } from './domain/classify.js';

/**
 * Every SQL statement the categories module runs. The domain decides; this
 * file reads and writes. Visibility (R57) matters for counts only: rows for a
 * hidden event are kept, because a policy change must bring the event back
 * with its categories and no re-scrape.
 */

/** What classification needs of one event. */
export interface ClassificationInput {
  readonly id: string;
  readonly rowid: number;
  readonly title: string;
  readonly description: string | null;
  readonly eventType: EventType;
  readonly sourceTags: string[];
}

interface EventInputRow {
  id: string;
  rowid: number;
  title: string;
  description_md: string | null;
  event_type: EventType;
  payloads: string | null;
}

/** `sourceTags` of each linked record's stored `EventCandidate`, de-duplicated, in first-seen order. */
function tagsFrom(payloads: string | null): string[] {
  if (payloads === null) return [];
  const out = new Set<string>();
  for (const payload of JSON.parse(payloads) as string[]) {
    try {
      const tags = (JSON.parse(payload) as { sourceTags?: unknown }).sourceTags;
      if (Array.isArray(tags)) {
        for (const tag of tags) if (typeof tag === 'string' && tag.trim() !== '') out.add(tag);
      }
    } catch {
      // A payload that is not JSON has no tags; the record is still a record.
    }
  }
  return [...out];
}

const EVENT_INPUT_SQL = `SELECT e.id, e.rowid AS rowid, e.title, e.description_md, e.event_type,
  (SELECT json_group_array(sr.payload_json) FROM source_records sr WHERE sr.event_id = e.id) AS payloads
  FROM events e`;

const toInput = (row: EventInputRow): ClassificationInput => ({
  id: row.id,
  rowid: row.rowid,
  title: row.title,
  description: row.description_md,
  eventType: row.event_type,
  sourceTags: tagsFrom(row.payloads),
});

export class CategoriesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  get raw(): DatabaseHandle['raw'] {
    return this.#db.raw;
  }

  // ---- Categories ---------------------------------------------------------------

  list(): Category[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT c.*, (SELECT count(*) FROM event_categories ec JOIN events e ON e.id = ec.event_id
           WHERE ec.category_id = c.id AND ec.is_suppressed = 0 AND e.visibility = 'VISIBLE') AS event_count
         FROM categories c ORDER BY c.sort_order, c.name`,
      )
      .all() as (Record<string, unknown> & { event_count: number })[];
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      parentId: (row.parent_id as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      colorToken: row.color_token as string,
      icon: (row.icon as string | null) ?? null,
      sortOrder: row.sort_order as number,
      isActive: row.is_active === 1,
      eventCount: row.event_count,
    }));
  }

  get(id: string): CategoryRow | undefined {
    const row = this.#db.raw.prepare('SELECT * FROM categories WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : toCategoryRow(row);
  }

  /** Which of name / slug another category already uses. */
  clash(name: string | undefined, slug: string | undefined, exceptId?: string): string | undefined {
    const row = this.#db.raw
      .prepare(`SELECT name, slug FROM categories WHERE (name = ? OR slug = ?) AND id <> ? LIMIT 1`)
      .get(name ?? null, slug ?? null, exceptId ?? '') as
      { name: string; slug: string } | undefined;
    if (row === undefined) return undefined;
    return row.name === name ? `name "${row.name}"` : `slug "${row.slug}"`;
  }

  insertCategory(row: CategoryRow): void {
    this.#db.raw
      .prepare(
        `INSERT INTO categories (id, name, slug, parent_id, description, color_token, icon, sort_order, is_active, created_by, created_at, updated_at)
         VALUES (@id, @name, @slug, @parentId, @description, @colorToken, @icon, @sortOrder, @isActive, @createdBy, @createdAt, @updatedAt)`,
      )
      .run({ ...row, isActive: row.isActive ? 1 : 0 });
  }

  updateCategory(row: CategoryRow): void {
    this.#db.raw
      .prepare(
        `UPDATE categories SET name = @name, slug = @slug, parent_id = @parentId, description = @description,
           color_token = @colorToken, icon = @icon, sort_order = @sortOrder, is_active = @isActive, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ ...row, isActive: row.isActive ? 1 : 0 });
  }

  /** Assignment rows of any event (hidden ones too) — "in use" for a delete. */
  usage(categoryId: string): number {
    return (
      this.#db.raw
        .prepare('SELECT count(*) AS n FROM event_categories WHERE category_id = ?')
        .get(categoryId) as { n: number }
    ).n;
  }

  /**
   * Moves a category's assignments and rules to `targetId`, then deletes it.
   * Where an event already has the target, the stronger row stays: MANUAL beats
   * anything automatic, which is D-15's rule applied to a merge of two categories.
   */
  deleteCategory(categoryId: string, targetId: string | undefined): void {
    const raw = this.#db.raw;
    if (targetId !== undefined) {
      raw
        .prepare(
          `DELETE FROM event_categories AS t WHERE t.category_id = ? AND t.origin <> 'MANUAL' AND EXISTS (
             SELECT 1 FROM event_categories s WHERE s.category_id = ? AND s.event_id = t.event_id AND s.origin = 'MANUAL')`,
        )
        .run(targetId, categoryId);
      raw
        .prepare(`UPDATE OR IGNORE event_categories SET category_id = ? WHERE category_id = ?`)
        .run(targetId, categoryId);
      raw
        .prepare('UPDATE category_rules SET category_id = ? WHERE category_id = ?')
        .run(targetId, categoryId);
    }
    raw.prepare('DELETE FROM event_categories WHERE category_id = ?').run(categoryId);
    raw.prepare('DELETE FROM category_rules WHERE category_id = ?').run(categoryId);
    raw.prepare('UPDATE categories SET parent_id = NULL WHERE parent_id = ?').run(categoryId);
    raw.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  }

  // ---- Rules ----------------------------------------------------------------------

  rules(categoryId?: string): CategoryRule[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT * FROM category_rules ${categoryId === undefined ? '' : 'WHERE category_id = ?'} ORDER BY category_id, weight DESC, id`,
      )
      .all(...(categoryId === undefined ? [] : [categoryId])) as Record<string, unknown>[];
    return rows.map((row) => toRule(toRuleRow(row)));
  }

  rule(id: string): CategoryRuleRow | undefined {
    const row = this.#db.raw.prepare('SELECT * FROM category_rules WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : toRuleRow(row);
  }

  /** Active rules of active categories — the only ones classification applies. */
  activeRules(): ClassifierRule[] {
    return this.#db.raw
      .prepare(
        `SELECT r.id, r.category_id AS categoryId, r.kind, r.pattern, r.fields, r.weight
         FROM category_rules r JOIN categories c ON c.id = r.category_id
         WHERE r.is_active = 1 AND c.is_active = 1 ORDER BY r.id`,
      )
      .all() as ClassifierRule[];
  }

  insertRule(row: CategoryRuleRow): void {
    this.#db.raw
      .prepare(
        `INSERT INTO category_rules (id, category_id, kind, pattern, fields, weight, is_active, created_at, updated_at)
         VALUES (@id, @categoryId, @kind, @pattern, @fields, @weight, @isActive, @createdAt, @updatedAt)`,
      )
      .run({ ...row, isActive: row.isActive ? 1 : 0 });
  }

  updateRule(row: CategoryRuleRow): void {
    this.#db.raw
      .prepare(
        `UPDATE category_rules SET category_id = @categoryId, kind = @kind, pattern = @pattern, fields = @fields,
           weight = @weight, is_active = @isActive, updated_at = @updatedAt WHERE id = @id`,
      )
      .run({ ...row, isActive: row.isActive ? 1 : 0 });
  }

  deleteRule(id: string): void {
    this.#db.raw.prepare('DELETE FROM category_rules WHERE id = ?').run(id);
  }

  // ---- Assignments ------------------------------------------------------------------

  classificationInput(eventId: string): ClassificationInput | undefined {
    const row = this.#db.raw.prepare(`${EVENT_INPUT_SQL} WHERE e.id = ?`).get(eventId) as
      EventInputRow | undefined;
    return row === undefined ? undefined : toInput(row);
  }

  /** The next chunk after `afterRowid`, merged events skipped (they are invisible and re-classified on unmerge). */
  chunk(afterRowid: number, size: number): ClassificationInput[] {
    return (
      this.#db.raw
        .prepare(
          `${EVENT_INPUT_SQL} WHERE e.rowid > ? AND e.visibility <> 'MERGED' ORDER BY e.rowid LIMIT ?`,
        )
        .all(afterRowid, size) as EventInputRow[]
    ).map(toInput);
  }

  /**
   * Replaces an event's automatic rows with `computed`. MANUAL rows — added or
   * suppressed — and AI rows are never touched, and a category that has one is
   * skipped, so a rule can neither downgrade a person's choice nor resurrect a
   * removal. Returns whether anything changed.
   */
  replaceAutomatic(eventId: string, computed: readonly ComputedAssignment[], at: number): boolean {
    const raw = this.#db.raw;
    const existing = raw
      .prepare(
        'SELECT category_id AS categoryId, origin, rule_id AS ruleId, confidence FROM event_categories WHERE event_id = ?',
      )
      .all(eventId) as {
      categoryId: string;
      origin: string;
      ruleId: string | null;
      confidence: number;
    }[];
    const byCategory = new Map(existing.map((row) => [row.categoryId, row]));
    const wanted = new Map(computed.map((row) => [row.categoryId, row]));
    let changed = false;
    for (const row of existing) {
      if ((row.origin === 'RULE' || row.origin === 'SOURCE_TAG') && !wanted.has(row.categoryId)) {
        raw
          .prepare('DELETE FROM event_categories WHERE event_id = ? AND category_id = ?')
          .run(eventId, row.categoryId);
        changed = true;
      }
    }
    const upsert = raw.prepare(
      `INSERT INTO event_categories (event_id, category_id, origin, rule_id, confidence, is_suppressed, assigned_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (event_id, category_id) DO UPDATE SET origin = excluded.origin, rule_id = excluded.rule_id,
         confidence = excluded.confidence, assigned_at = excluded.assigned_at
       WHERE event_categories.origin IN ('RULE', 'SOURCE_TAG')`,
    );
    for (const row of computed) {
      const current = byCategory.get(row.categoryId);
      if (current !== undefined && current.origin !== 'RULE' && current.origin !== 'SOURCE_TAG') {
        continue;
      }
      if (
        current?.origin === row.origin &&
        current.ruleId === row.ruleId &&
        current.confidence === row.confidence
      ) {
        continue;
      }
      upsert.run(eventId, row.categoryId, row.origin, row.ruleId, row.confidence, at);
      changed = true;
    }
    return changed;
  }

  /** A professor's choice (D-15): `suppressed` removes the category from the event whatever the rules say. */
  setManual(
    eventId: string,
    categoryId: string,
    suppressed: boolean,
    userId: string,
    at: number,
  ): void {
    this.#db.raw
      .prepare(
        `INSERT INTO event_categories (event_id, category_id, origin, rule_id, confidence, is_suppressed, assigned_by, assigned_at)
         VALUES (?, ?, 'MANUAL', NULL, 1, ?, ?, ?)
         ON CONFLICT (event_id, category_id) DO UPDATE SET origin = 'MANUAL', rule_id = NULL, confidence = 1,
           is_suppressed = excluded.is_suppressed, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
      )
      .run(eventId, categoryId, suppressed ? 1 : 0, userId, at);
  }

  // ---- Re-classification runs -----------------------------------------------------------

  requestRun(reason: string, userId: string | null, at: number): string {
    const id = uuid7();
    // A newer rule set supersedes a half-finished pass: it starts again from the top.
    this.#db.raw
      .prepare('UPDATE category_reclassify_runs SET finished_at = ? WHERE finished_at IS NULL')
      .run(at);
    this.#db.raw
      .prepare(
        'INSERT INTO category_reclassify_runs (id, reason, requested_at, requested_by) VALUES (?, ?, ?, ?)',
      )
      .run(id, reason, at, userId);
    return id;
  }

  pendingRun(): { id: string; afterRowid: number; eventsDone: number } | undefined {
    return this.#db.raw
      .prepare(
        `SELECT id, after_rowid AS afterRowid, events_done AS eventsDone FROM category_reclassify_runs
         WHERE finished_at IS NULL ORDER BY requested_at DESC, id DESC LIMIT 1`,
      )
      .get() as { id: string; afterRowid: number; eventsDone: number } | undefined;
  }

  advanceRun(id: string, afterRowid: number, eventsDone: number, finishedAt: number | null): void {
    this.#db.raw
      .prepare(
        'UPDATE category_reclassify_runs SET after_rowid = ?, events_done = ?, finished_at = ? WHERE id = ?',
      )
      .run(afterRowid, eventsDone, finishedAt, id);
  }

  /** Visible events, in id order, for a rule preview. */
  *visibleInputs(): Generator<ClassificationInput> {
    const statement = this.#db.raw.prepare(
      `${EVENT_INPUT_SQL} WHERE e.visibility = 'VISIBLE' AND e.merged_into_event_id IS NULL ORDER BY e.id`,
    );
    for (const row of statement.iterate() as Iterable<EventInputRow>) yield toInput(row);
  }
}

function toCategoryRow(row: Record<string, unknown>): CategoryRow {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    parentId: (row.parent_id as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    colorToken: row.color_token as string,
    icon: (row.icon as string | null) ?? null,
    sortOrder: row.sort_order as number,
    isActive: row.is_active === 1,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function toRuleRow(row: Record<string, unknown>): CategoryRuleRow {
  return {
    id: row.id as string,
    categoryId: row.category_id as string,
    kind: row.kind as CategoryRuleRow['kind'],
    pattern: row.pattern as string,
    fields: row.fields as CategoryRuleRow['fields'],
    weight: row.weight as number,
    isActive: row.is_active === 1,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function toRule(row: CategoryRuleRow): CategoryRule {
  return {
    id: row.id,
    categoryId: row.categoryId,
    kind: row.kind,
    pattern: row.pattern,
    fields: row.fields,
    weight: row.weight,
    isActive: row.isActive,
  };
}
