import type { OutcomeResult } from '@compintel/contracts';

import type { ValidOutcome } from '../../domain/outcomes/validate.js';
import type { DatabaseHandle } from '../../platform/db.js';

/** SQL for `engagement_outcomes` (WP-21, R104). */

export interface OutcomeRecord extends ValidOutcome {
  readonly engagementId: string;
  readonly certificateResourceId: string | null;
  readonly recordedBy: string;
  readonly recordedByName: string;
  readonly recordedAt: number;
  readonly version: number;
}

const COLUMNS = `o.engagement_id AS engagementId, o.result, o.rank, o.prize_text AS prizeText,
  o.prize_minor AS prizeMinor, o.prize_currency AS prizeCurrency,
  o.certificate_resource_id AS certificateResourceId, o.result_url AS resultUrl, o.notes,
  o.feedback, o.recorded_by AS recordedBy, u.display_name AS recordedByName,
  o.recorded_at AS recordedAt, o.version`;

export class OutcomesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  find(engagementId: string): OutcomeRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT ${COLUMNS} FROM engagement_outcomes o JOIN users u ON u.id = o.recorded_by
         WHERE o.engagement_id = ?`,
      )
      .get(engagementId) as OutcomeRecord | undefined;
  }

  results(ids: readonly string[]): Map<string, OutcomeResult> {
    if (ids.length === 0) return new Map();
    const rows = this.#db.raw
      .prepare(
        `SELECT engagement_id AS id, result FROM engagement_outcomes
         WHERE engagement_id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(...ids) as { id: string; result: OutcomeResult }[];
    return new Map(rows.map((row) => [row.id, row.result]));
  }

  insert(
    row: ValidOutcome & {
      engagementId: string;
      certificateResourceId: string | null;
      recordedBy: string;
      recordedAt: number;
    },
  ): void {
    this.#db.raw
      .prepare(
        `INSERT INTO engagement_outcomes (engagement_id, result, rank, prize_text, prize_minor,
           prize_currency, certificate_resource_id, result_url, notes, feedback, recorded_by, recorded_at)
         VALUES (@engagementId, @result, @rank, @prizeText, @prizeMinor, @prizeCurrency,
           @certificateResourceId, @resultUrl, @notes, @feedback, @recordedBy, @recordedAt)`,
      )
      .run(row);
  }

  /** An edit in place: the fields, the certificate, version + 1; who recorded it stays. */
  update(engagementId: string, row: ValidOutcome & { certificateResourceId: string | null }): void {
    this.#db.raw
      .prepare(
        `UPDATE engagement_outcomes SET result = @result, rank = @rank, prize_text = @prizeText,
           prize_minor = @prizeMinor, prize_currency = @prizeCurrency,
           certificate_resource_id = @certificateResourceId, result_url = @resultUrl,
           notes = @notes, feedback = @feedback, version = version + 1
         WHERE engagement_id = @engagementId`,
      )
      .run({ ...row, engagementId });
  }

  delete(engagementId: string): void {
    this.#db.raw
      .prepare('DELETE FROM engagement_outcomes WHERE engagement_id = ?')
      .run(engagementId);
  }
}
