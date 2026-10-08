import type { CompetitionRef, EngagementStatus, ParticipantKind } from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';

/**
 * What the Team and Student pages show of competitions (WP-19 step 4), and
 * R97's "open" test that archiving a team must respect.
 */

const OPEN_FIRST = `CASE WHEN g.status IN ('COMPLETED', 'WITHDRAWN', 'NOT_SELECTED') THEN 1 ELSE 0 END`;

interface Row {
  readonly id: string;
  readonly eventTitle: string;
  readonly status: EngagementStatus;
  readonly kind: ParticipantKind;
  readonly teamName: string | null;
  readonly onRoster: number;
}

const toRef = (row: Row): CompetitionRef => ({ ...row, onRoster: row.onRoster === 1 });

export class CompetitionLinksRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  ofTeam(teamId: string): CompetitionRef[] {
    return (
      this.#db.raw
        .prepare(
          `SELECT g.id, e.title AS eventTitle, g.status, g.participant_kind AS kind, t.name AS teamName,
             1 AS onRoster
           FROM engagements g JOIN events e ON e.id = g.event_id JOIN teams t ON t.id = g.team_id
           WHERE g.team_id = ? ORDER BY ${OPEN_FIRST}, g.status_changed_at DESC, g.id`,
        )
        .all(teamId) as Row[]
    ).map(toRef);
  }

  ofStudent(studentId: string): CompetitionRef[] {
    return (
      this.#db.raw
        .prepare(
          `SELECT g.id, e.title AS eventTitle, g.status, g.participant_kind AS kind, t.name AS teamName,
             p.removed_at IS NULL AS onRoster
           FROM engagement_participants p
           JOIN engagements g ON g.id = p.engagement_id
           JOIN events e ON e.id = g.event_id
           LEFT JOIN teams t ON t.id = g.team_id
           WHERE p.student_id = ? ORDER BY ${OPEN_FIRST}, g.status_changed_at DESC, g.id`,
        )
        .all(studentId) as Row[]
    ).map(toRef);
  }

  /** R97's "still taken on": not COMPLETED, WITHDRAWN or NOT_SELECTED. */
  openOfTeam(teamId: string): { id: string; name: string }[] {
    return this.ofTeam(teamId)
      .filter((ref) => !['COMPLETED', 'WITHDRAWN', 'NOT_SELECTED'].includes(ref.status))
      .map((ref) => ({ id: ref.id, name: `${ref.teamName ?? ''} — ${ref.eventTitle}` }));
  }
}
