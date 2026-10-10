import {
  ACTIVE_COMPETITION_STATUSES,
  type NamedCount,
  type OutcomeResult,
} from '@compintel/contracts';

import type {
  CompetitionFacts,
  StageFacts,
  StatusChange,
} from '../../domain/insights/aggregate.js';
import type { Span } from '../../domain/insights/calendar.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * The competitions side of the Insights read model (WP-33, R69). Plain SQL over
 * rows that already exist; every method is a SELECT. "In the range" means a
 * competition *created* in the range unless a method says otherwise.
 */

const ACTIVE_LIST = ACTIVE_COMPETITION_STATUSES.map((status) => `'${status}'`).join(', ');
const TOP = 10;

interface Counted {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

export interface MentorRow {
  readonly userId: string;
  readonly name: string;
  readonly active: number;
  readonly total: number;
}

export class EngagementInsightsReader {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  #all<T>(sql: string, ...params: unknown[]): T[] {
    return this.#db.raw.prepare(sql).all(...params) as T[];
  }

  /** True once the department has ever had a competition. */
  hasAny(): boolean {
    return this.#db.raw.prepare('SELECT 1 FROM engagements LIMIT 1').get() !== undefined;
  }

  /** Every status change ever made — the input to months, streaks and milestones. */
  history(): StatusChange[] {
    return this.#all<StatusChange>(
      `SELECT engagement_id AS engagementId, to_status AS toStatus, changed_at AS changedAt
         FROM engagement_status_history ORDER BY changed_at, id`,
    );
  }

  created(span: Span): CompetitionFacts[] {
    return this.#all<CompetitionFacts>(
      `SELECT id, status, created_at AS createdAt FROM engagements
        WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id`,
      span.start,
      span.end,
    );
  }

  eventsByType(span: Span): { type: string; count: number }[] {
    return this.#all(
      `SELECT e.event_type AS type, COUNT(DISTINCT e.id) AS count
         FROM engagements g JOIN events e ON e.id = g.event_id
        WHERE g.created_at >= ? AND g.created_at < ?
        GROUP BY e.event_type ORDER BY count DESC, type`,
      span.start,
      span.end,
    );
  }

  eventsByMode(span: Span): { mode: string; count: number }[] {
    return this.#all(
      `SELECT e.mode AS mode, COUNT(DISTINCT e.id) AS count
         FROM engagements g JOIN events e ON e.id = g.event_id
        WHERE g.created_at >= ? AND g.created_at < ?
        GROUP BY e.mode ORDER BY count DESC, mode`,
      span.start,
      span.end,
    );
  }

  /** Outcomes recorded in the range, by result. */
  outcomes(span: Span): { result: OutcomeResult; count: number }[] {
    return this.#all(
      `SELECT result, COUNT(*) AS count FROM engagement_outcomes
        WHERE recorded_at >= ? AND recorded_at < ? GROUP BY result`,
      span.start,
      span.end,
    );
  }

  /** When every WINNER outcome was recorded (for the milestone). */
  winnerTimes(): number[] {
    return this.#all<{ at: number }>(
      "SELECT recorded_at AS at FROM engagement_outcomes WHERE result = 'WINNER'",
    ).map((row) => row.at);
  }

  /** Competitions per student among the range's competitions; roster removals excluded. */
  students(span: Span): { distinct: number; top: NamedCount[] } {
    const from = `FROM engagement_participants p JOIN engagements g ON g.id = p.engagement_id
                   JOIN students s ON s.id = p.student_id
                  WHERE p.removed_at IS NULL AND g.created_at >= ? AND g.created_at < ?`;
    const top = this.#all<Counted>(
      `SELECT s.id AS id, s.full_name AS name, COUNT(DISTINCT g.id) AS count ${from}
        GROUP BY s.id ORDER BY count DESC, name, id LIMIT ${String(TOP)}`,
      span.start,
      span.end,
    );
    const row = this.#db.raw
      .prepare(`SELECT COUNT(DISTINCT s.id) AS n ${from}`)
      .get(span.start, span.end) as { n: number };
    return { distinct: row.n, top: [...top] };
  }

  /** Competitions per team among the range's competitions. */
  teams(span: Span): { distinct: number; top: NamedCount[] } {
    const from = `FROM engagements g JOIN teams t ON t.id = g.team_id
                  WHERE g.created_at >= ? AND g.created_at < ?`;
    const top = this.#all<Counted>(
      `SELECT t.id AS id, t.name AS name, COUNT(*) AS count ${from}
        GROUP BY t.id ORDER BY count DESC, name, id LIMIT ${String(TOP)}`,
      span.start,
      span.end,
    );
    const row = this.#db.raw
      .prepare(`SELECT COUNT(DISTINCT t.id) AS n ${from}`)
      .get(span.start, span.end) as { n: number };
    return { distinct: row.n, top: [...top] };
  }

  /**
   * Mentor load: `active` = competitions they mentor now that are active (all
   * time — load is a "now" fact), `total` = the range's competitions they
   * mentor or mentored.
   */
  mentors(span: Span): MentorRow[] {
    return this.#all<MentorRow>(
      `SELECT u.id AS userId, u.display_name AS name,
              COUNT(DISTINCT CASE WHEN m.to_at IS NULL AND g.status IN (${ACTIVE_LIST})
                                  THEN g.id END) AS active,
              COUNT(DISTINCT CASE WHEN g.created_at >= ? AND g.created_at < ?
                                  THEN g.id END) AS total
         FROM engagement_mentors m
         JOIN engagements g ON g.id = m.engagement_id
         JOIN users u ON u.id = m.user_id
        GROUP BY u.id
       HAVING active > 0 OR total > 0
        ORDER BY active DESC, total DESC, name, userId`,
      span.start,
      span.end,
    );
  }

  /**
   * Stages for the deadline-hit rate: every dated stage due in the range, and
   * every undated stage of the range's competitions. A withdrawn or unselected
   * competition's stages are left out — abandoning work is not missing it.
   */
  stages(span: Span): StageFacts[] {
    const open = `g.status NOT IN ('WITHDRAWN', 'NOT_SELECTED')`;
    return this.#all<StageFacts>(
      `SELECT s.due_at AS dueAt, s.completed_at AS completedAt
         FROM workflow_stages s JOIN workflows w ON w.id = s.workflow_id
         JOIN engagements g ON g.id = w.engagement_id
        WHERE ${open} AND ((s.due_at >= ? AND s.due_at < ?)
           OR (s.due_at IS NULL AND g.created_at >= ? AND g.created_at < ?))`,
      span.start,
      span.end,
      span.start,
      span.end,
    );
  }
}
