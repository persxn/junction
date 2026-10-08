import { bucketBounds } from '../domain/deadlines/buckets.js';
import type { Principal } from '../modules/auth/types.js';
import type { WorkflowsModule } from '../modules/workflows/wiring.js';
import type { DatabaseHandle } from '../platform/db.js';
import { uuid7 } from '../platform/ids.js';

/**
 * WP-22: demo data for the Deadline Radar (D-33, synthetic only) — open
 * competitions' stages and tasks due in every bucket (overdue, today, within
 * 3 and 7 days, later), and saved events with deadlines in every precision.
 * Stage and task dates go through the real writes, so they are audited.
 */

const DAY = 86_400_000;

/** Offsets from `now` for the five buckets; "today" is halfway to midnight IST, whenever it runs. */
export function demoBucketOffsets(now: number): readonly number[] {
  const todayLeft = bucketBounds(now).endOfToday - now;
  return [-2 * DAY, Math.floor(todayLeft / 2), 2 * DAY, 5 * DAY, 20 * DAY];
}

export function seedDemoDeadlines(input: {
  readonly db: DatabaseHandle;
  readonly workflows: WorkflowsModule;
  readonly competitionIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly professor: Principal;
  readonly now: number;
}): { stages: number; tasks: number; eventDeadlines: number } {
  const { db, workflows, professor, now } = input;
  const context = { actor: professor };
  let stages = 0;
  let tasks = 0;
  const offsets = demoBucketOffsets(now);
  for (const competitionId of input.competitionIds) {
    let view = workflows.reader.view(professor, competitionId);
    view.stages.slice(0, offsets.length).forEach((stage, index) => {
      const current = view.stages.find((s) => s.id === stage.id);
      if (current === undefined) return;
      view = workflows.stages.update(context, competitionId, stage.id, {
        dueAt: new Date(now + (offsets[index] ?? 0)).toISOString(),
        version: current.version,
      });
      stages += 1;
    });
    const first = view.stages[0];
    const task = first?.tasks.find((t) => !t.isDone);
    if (first !== undefined && task !== undefined) {
      workflows.tasks.update(context, competitionId, task.id, {
        dueAt: new Date(now - DAY).toISOString(),
        version: first.version,
      });
      tasks += 1;
    }
  }
  // Saved events, each with a deadline in one precision (UNKNOWN stays off the Radar).
  const precisions = ['DATETIME', 'DATE', 'MONTH', 'UNKNOWN'] as const;
  let eventDeadlines = 0;
  input.eventIds.slice(0, precisions.length).forEach((eventId, index) => {
    db.raw
      .prepare(
        'INSERT OR IGNORE INTO watchlist_items (user_id, event_id, added_at) VALUES (?, ?, ?)',
      )
      .run(professor.id, eventId, now);
    db.raw
      .prepare(
        `INSERT INTO event_deadlines (id, event_id, kind, label, due_at, precision, origin, created_at, updated_at)
         VALUES (?, ?, 'PPT', 'Presentation due', ?, ?, 'MANUAL', ?, ?)`,
      )
      .run(uuid7(), eventId, now + (index + 1) * 2 * DAY, precisions[index], now, now);
    eventDeadlines += 1;
  });
  return { stages, tasks, eventDeadlines };
}
