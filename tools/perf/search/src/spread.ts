import type { DatabaseHandle } from '@compintel/backend';

/**
 * `seed:demo --students --spread` (WP-33): the demo competitions are all
 * created "now", which leaves Insights with one month and one week to show.
 * This moves each competition's whole history back by a fixed number of days —
 * creation, every status change, mentors, roster, outcome and, for closed
 * ones, its stages — so the year fills in. Order within a competition is kept,
 * so every count Insights makes is still a count of what the rows say.
 * Synthetic data only (D-33).
 */

const DAY = 86_400_000;
const ACTIVE = "('ASSIGNED', 'APPLIED', 'PARTICIPATING')";

export function spreadOverYear(db: DatabaseHandle): { competitions: number } {
  const rows = db.raw
    .prepare('SELECT id, status FROM engagements ORDER BY created_at, id')
    .all() as { id: string; status: string }[];
  const shift = db.raw.transaction(() => {
    rows.forEach((row, index) => {
      // Oldest first: spread over ~11 months, newest left at today.
      const days = Math.round(((rows.length - 1 - index) * 330) / Math.max(rows.length, 1));
      const by = days * DAY;
      const run = (sql: string): void => {
        db.raw.prepare(sql).run({ by, id: row.id });
      };
      run(
        'UPDATE engagements SET created_at = created_at - @by, updated_at = updated_at - @by, status_changed_at = status_changed_at - @by WHERE id = @id',
      );
      run(
        'UPDATE engagement_status_history SET changed_at = changed_at - @by WHERE engagement_id = @id',
      );
      run(
        'UPDATE engagement_mentors SET from_at = from_at - @by, to_at = to_at - @by WHERE engagement_id = @id',
      );
      run('UPDATE engagement_participants SET added_at = added_at - @by WHERE engagement_id = @id');
      run(
        'UPDATE engagement_outcomes SET recorded_at = recorded_at - @by WHERE engagement_id = @id',
      );
      // Open competitions keep their stage dates, so the Dashboard's health and
      // the Radar still read as they did; closed ones move with their history.
      db.raw
        .prepare(
          `UPDATE workflow_stages SET due_at = due_at - @by, completed_at = completed_at - @by,
             started_at = started_at - @by
           WHERE workflow_id IN (SELECT w.id FROM workflows w JOIN engagements g ON g.id = w.engagement_id
                                  WHERE g.id = @id AND g.status NOT IN ${ACTIVE})`,
        )
        .run({ by, id: row.id });
    });
  });
  shift();
  return { competitions: rows.length };
}
