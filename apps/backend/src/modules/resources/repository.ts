import type {
  CheckStatus,
  CheckedStatus,
  ResourceKind,
  ResourceOwnerKind,
} from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';

/**
 * SQL for `resources` (WP-20b, R103). The owner is polymorphic, so there is no
 * foreign key: every owner is resolved here to the competition it belongs to,
 * and an owner that resolves to nothing is the caller's "not found".
 */

export interface ResourceRecord {
  readonly id: string;
  readonly ownerKind: ResourceOwnerKind;
  readonly ownerId: string;
  readonly kind: ResourceKind;
  readonly label: string;
  readonly uri: string;
  readonly machineLabel: string | null;
  readonly lastCheckedAt: number | null;
  readonly checkStatus: CheckStatus;
  readonly addedBy: string;
  readonly addedByName: string;
  readonly addedAt: number;
  readonly version: number;
}

/** A row with where it hangs, for grouping on the page. */
export interface PlacedResource extends ResourceRecord {
  /** The stage's or task's name; null for the competition and its outcome. */
  readonly ownerName: string | null;
  /** Stage position, then task position, so groups follow the workflow's order. */
  readonly stagePosition: number | null;
  readonly taskPosition: number | null;
}

const COLUMNS = `r.id, r.owner_kind AS ownerKind, r.owner_id AS ownerId, r.kind, r.label, r.uri,
  r.machine_label AS machineLabel, r.last_checked_at AS lastCheckedAt, r.check_status AS checkStatus,
  r.added_by AS addedBy, u.display_name AS addedByName, r.added_at AS addedAt, r.version`;

export class ResourcesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** The competition an owner belongs to, or undefined when there is no such owner. */
  competitionOf(kind: ResourceOwnerKind, ownerId: string): string | undefined {
    const sql: Record<ResourceOwnerKind, string> = {
      ENGAGEMENT: 'SELECT id FROM engagements WHERE id = ?',
      // The outcome's key is its competition's id (R103).
      OUTCOME: 'SELECT id FROM engagements WHERE id = ?',
      STAGE: `SELECT w.engagement_id AS id FROM workflow_stages s
                JOIN workflows w ON w.id = s.workflow_id WHERE s.id = ?`,
      TASK: `SELECT w.engagement_id AS id FROM tasks t
               JOIN workflow_stages s ON s.id = t.stage_id
               JOIN workflows w ON w.id = s.workflow_id WHERE t.id = ?`,
    };
    const row = this.#db.raw.prepare(sql[kind]).get(ownerId) as { id: string } | undefined;
    return row?.id;
  }

  find(id: string): ResourceRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT ${COLUMNS} FROM resources r JOIN users u ON u.id = r.added_by WHERE r.id = ?`,
      )
      .get(id) as ResourceRecord | undefined;
  }

  /** Every resource of one competition, at every level, in page order. */
  forCompetition(competitionId: string): PlacedResource[] {
    return this.#db.raw
      .prepare(
        `SELECT ${COLUMNS},
           coalesce(s.name, ts.name) AS stageName, t.title AS taskTitle,
           coalesce(s.position, ts.position) AS stagePosition, t.position AS taskPosition
         FROM resources r
         JOIN users u ON u.id = r.added_by
         LEFT JOIN workflow_stages s ON r.owner_kind = 'STAGE' AND s.id = r.owner_id
         LEFT JOIN tasks t ON r.owner_kind = 'TASK' AND t.id = r.owner_id
         LEFT JOIN workflow_stages ts ON ts.id = t.stage_id
         LEFT JOIN workflows w ON w.id = coalesce(s.workflow_id, ts.workflow_id)
         WHERE ((r.owner_kind IN ('ENGAGEMENT', 'OUTCOME') AND r.owner_id = @id)
            OR w.engagement_id = @id)
         ORDER BY CASE r.owner_kind WHEN 'ENGAGEMENT' THEN 0 WHEN 'OUTCOME' THEN 1 ELSE 2 END,
           stagePosition, r.owner_kind = 'TASK', taskPosition, r.added_at, r.id`,
      )
      .all({ id: competitionId })
      .map((row) => {
        const { stageName, taskTitle, ...rest } = row as PlacedResource & {
          stageName: string | null;
          taskTitle: string | null;
        };
        return { ...rest, ownerName: rest.ownerKind === 'TASK' ? taskTitle : stageName };
      });
  }

  insert(row: {
    id: string;
    ownerKind: ResourceOwnerKind;
    ownerId: string;
    kind: ResourceKind;
    label: string;
    uri: string;
    machineLabel: string | null;
    addedBy: string;
    addedAt: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO resources (id, owner_kind, owner_id, kind, label, uri, machine_label, added_by, added_at)
         VALUES (@id, @ownerKind, @ownerId, @kind, @label, @uri, @machineLabel, @addedBy, @addedAt)`,
      )
      .run(row);
  }

  /** A person's edit: the fields given, a fresh check state if the target moved, version + 1. */
  update(
    id: string,
    patch: {
      label: string;
      uri: string;
      kind: ResourceKind;
      machineLabel: string | null;
      resetCheck: boolean;
    },
  ): void {
    this.#db.raw
      .prepare(
        `UPDATE resources SET label = @label, uri = @uri, kind = @kind, machine_label = @machineLabel,
           check_status = CASE WHEN @resetCheck THEN 'UNCHECKED' ELSE check_status END,
           last_checked_at = CASE WHEN @resetCheck THEN NULL ELSE last_checked_at END,
           version = version + 1
         WHERE id = @id`,
      )
      .run({ id, ...patch, resetCheck: patch.resetCheck ? 1 : 0 });
  }

  delete(id: string): void {
    this.#db.raw.prepare('DELETE FROM resources WHERE id = ?').run(id);
  }

  /** R103: machine state — LOCAL_PATH rows only, no version bump. Returns whether a row changed. */
  recordCheck(id: string, status: CheckedStatus, at: number): boolean {
    return (
      this.#db.raw
        .prepare(
          `UPDATE resources SET check_status = ?, last_checked_at = ?
           WHERE id = ? AND kind = 'LOCAL_PATH'`,
        )
        .run(status, at, id).changes > 0
    );
  }
}
