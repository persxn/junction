import type { StudentHistory } from '@compintel/contracts';

import { outcomeState } from '../../domain/outcomes/visibility.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { studentNotFound } from './errors.js';
import type { StudentHistoryRepository } from './history-repo.js';

/**
 * A student's history (§16.2 "Student", R104, WP-21): competitions with their
 * outcome as this student may see it, team memberships, and achievements from
 * before the app — each newest first, read in one request from the tables
 * that already exist. An erased student keeps their competitions and teams;
 * achievements went with the erasure (R92).
 */

const iso = (at: number): string => new Date(at).toISOString();
const isoOrNull = (at: number | null): string | null => (at === null ? null : iso(at));

export class StudentHistoryService {
  readonly #repo: StudentHistoryRepository;

  constructor(repo: StudentHistoryRepository) {
    this.#repo = repo;
  }

  history(actor: Principal, studentId: string): StudentHistory {
    assertCan(actor, 'student.view');
    const student = this.#repo.student(studentId);
    if (student === undefined) throw studentNotFound();
    const erased = student.erasedAt !== null;
    return {
      studentId,
      erased,
      competitions: this.#repo.competitions(studentId).map((row) => {
        const state = outcomeState(row.addedAt, row.removedAt, row.recordedAt);
        return {
          competitionId: row.competitionId,
          eventTitle: row.eventTitle,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          datePrecision: row.datePrecision,
          teamName: row.teamName,
          status: row.status,
          outcomeState: state,
          outcome:
            state === 'SHOWN' && row.result !== null
              ? {
                  result: row.result,
                  rank: row.rank,
                  prizeText: row.prizeText,
                  prizeMinor: row.prizeMinor,
                  prizeCurrency: row.prizeCurrency,
                }
              : null,
          addedAt: iso(row.addedAt),
          removedAt: isoOrNull(row.removedAt),
        };
      }),
      teams: this.#repo.teams(studentId).map((row) => ({
        teamId: row.teamId,
        teamName: row.teamName,
        joinedAt: iso(row.joinedAt),
        leftAt: isoOrNull(row.leftAt),
        isLead: row.isLead === 1,
        roleLabel: row.roleLabel,
      })),
      achievements: erased ? [] : this.#repo.achievements(studentId),
    };
  }
}
