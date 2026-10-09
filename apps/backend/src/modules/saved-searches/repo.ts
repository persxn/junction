import type { DatabaseHandle } from '../../platform/db.js';

/**
 * Every statement saved searches run (§6.2, R112). Ownership is part of each
 * owner-facing statement's WHERE, so a search that is not yours reads as absent.
 */

export interface SavedSearchRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly queryJson: string;
  readonly notifyOnNew: boolean;
  readonly lastEvaluatedAt: number | null;
  readonly lastResultHash: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly version: number;
}

const columns = (t: string): string =>
  `${t}.id, ${t}.user_id AS userId, ${t}.name, ${t}.query_json AS queryJson,
   ${t}.notify_on_new AS notifyOnNew, ${t}.last_evaluated_at AS lastEvaluatedAt,
   ${t}.last_result_hash AS lastResultHash, ${t}.created_at AS createdAt,
   ${t}.updated_at AS updatedAt, ${t}.version`;

type RawRecord = Omit<SavedSearchRecord, 'notifyOnNew'> & { notifyOnNew: number };
const toRecord = (row: RawRecord): SavedSearchRecord => ({
  ...row,
  notifyOnNew: row.notifyOnNew === 1,
});

export class SavedSearchesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  transaction<T>(work: () => T): T {
    return this.#db.raw.transaction(work)();
  }

  listOwned(userId: string): SavedSearchRecord[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT ${columns('s')} FROM saved_searches s WHERE s.user_id = ? ORDER BY s.name COLLATE NOCASE, s.id`,
      )
      .all(userId) as RawRecord[];
    return rows.map(toRecord);
  }

  findOwned(userId: string, id: string): SavedSearchRecord | undefined {
    const row = this.#db.raw
      .prepare(`SELECT ${columns('s')} FROM saved_searches s WHERE s.id = ? AND s.user_id = ?`)
      .get(id, userId) as RawRecord | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  /** Every search whose owner is still active — the evaluator's work list. */
  evaluable(): SavedSearchRecord[] {
    const rows = this.#db.raw
      .prepare(
        `SELECT ${columns('s')} FROM saved_searches s
         JOIN users u ON u.id = s.user_id WHERE u.status = 'ACTIVE' ORDER BY s.id`,
      )
      .all() as RawRecord[];
    return rows.map(toRecord);
  }

  /** Case-insensitive, so "AI" and "ai" are one name to a person. */
  nameTaken(userId: string, name: string, exceptId: string | null): boolean {
    return (
      this.#db.raw
        .prepare(
          `SELECT 1 FROM saved_searches WHERE user_id = ? AND lower(name) = lower(?) AND id <> coalesce(?, '')`,
        )
        .get(userId, name, exceptId) !== undefined
    );
  }

  /** The owner's department, else the managing one (null on a database with none). */
  departmentFor(userId: string): string | null {
    const row = this.#db.raw
      .prepare(
        `SELECT coalesce((SELECT department_id FROM users WHERE id = ?),
           (SELECT id FROM departments ORDER BY is_managing DESC, created_at LIMIT 1)) AS id`,
      )
      .get(userId) as { id: string | null };
    return row.id;
  }

  insert(row: {
    id: string;
    userId: string;
    departmentId: string | null;
    name: string;
    queryJson: string;
    notifyOnNew: boolean;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO saved_searches (id, user_id, department_id, name, query_json, notify_on_new,
           created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        row.id,
        row.userId,
        row.departmentId,
        row.name,
        row.queryJson,
        row.notifyOnNew ? 1 : 0,
        row.at,
        row.at,
      );
  }

  /** Writes the changed fields and bumps the version; false when `version` is stale. */
  update(
    id: string,
    version: number,
    patch: { name: string; queryJson: string; notifyOnNew: boolean },
    at: number,
  ): boolean {
    return (
      this.#db.raw
        .prepare(
          `UPDATE saved_searches SET name = ?, query_json = ?, notify_on_new = ?, updated_at = ?,
             version = version + 1 WHERE id = ? AND version = ?`,
        )
        .run(patch.name, patch.queryJson, patch.notifyOnNew ? 1 : 0, at, id, version).changes > 0
    );
  }

  delete(id: string, version: number): boolean {
    return (
      this.#db.raw
        .prepare('DELETE FROM saved_searches WHERE id = ? AND version = ?')
        .run(id, version).changes > 0
    );
  }

  /** The remembered set (R112): every event id this search has ever matched. */
  matchSet(id: string): Set<string> {
    const rows = this.#db.raw
      .prepare('SELECT event_id AS eventId FROM saved_search_matches WHERE saved_search_id = ?')
      .all(id) as { eventId: string }[];
    return new Set(rows.map((row) => row.eventId));
  }

  addMatches(id: string, eventIds: readonly string[], at: number): void {
    const insert = this.#db.raw.prepare(
      `INSERT INTO saved_search_matches (saved_search_id, event_id, first_matched_at) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`,
    );
    for (const eventId of eventIds) insert.run(id, eventId, at);
  }

  /** A changed query starts over (R112): the old query's matches say nothing about the new one. */
  clearMatches(id: string): void {
    this.#db.raw.prepare('DELETE FROM saved_search_matches WHERE saved_search_id = ?').run(id);
  }

  /** Bookkeeping only: never bumps `version`, so an open dialog's edit still applies. */
  markEvaluated(id: string, at: number, hash: string): void {
    this.#db.raw
      .prepare('UPDATE saved_searches SET last_evaluated_at = ?, last_result_hash = ? WHERE id = ?')
      .run(at, hash, id);
  }

  /** Titles of `ids`, in the order given. */
  titles(ids: readonly string[]): { id: string; title: string }[] {
    if (ids.length === 0) return [];
    const rows = this.#db.raw
      .prepare(`SELECT id, title FROM events WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as { id: string; title: string }[];
    const byId = new Map(rows.map((row) => [row.id, row.title]));
    return ids.flatMap((id) => {
      const title = byId.get(id);
      return title === undefined ? [] : [{ id, title }];
    });
  }
}
