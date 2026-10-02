import type {
  TeamAddMentorRequest,
  TeamDetail,
  TeamTransferPrimaryRequest,
} from '@compintel/contracts';

import { teamRef } from '../../domain/teams/coverage.js';
import { withAudit } from '../../platform/audit.js';
import { validationFailed } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import { mentorExists, mentorNotFound, mentorNotProfessor } from './errors.js';
import { TeamReader, type TeamsContext, type TeamsDependencies } from './reader.js';
import type { TeamRecord } from './repository.js';

/**
 * A team's mentors (§10.2 "add/remove mentors": the primary only; R95).
 *
 * Co-mentors are added and stepped down; the PRIMARY is never removed, only
 * handed over: transfer closes the PRIMARY row and opens one for another
 * professor, and the old primary stays as a co-mentor unless they step away —
 * all in one transaction, so there is exactly one open PRIMARY before and after.
 * This is the within-team transfer; WP-21's admin bulk transfer is separate.
 */
export class TeamMentorsService {
  readonly #deps: TeamsDependencies;
  readonly #clock: Clock;
  readonly #reader: TeamReader;

  constructor(deps: TeamsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new TeamReader(deps);
  }

  add(context: TeamsContext, teamId: string, request: TeamAddMentorRequest): TeamDetail {
    const team = this.#reader.requireWritable(teamId, request.version);
    assertCan(context.actor, 'team.manage_mentors', this.#reader.facts(context.actor, teamId));
    if (!this.#deps.teams.isActiveProfessor(request.userId)) throw mentorNotProfessor();
    if (this.#deps.teams.openMentors(teamId).some((row) => row.userId === request.userId)) {
      throw mentorExists();
    }
    this.#audited(
      context,
      team,
      'team.mentor_added',
      `Added a co-mentor to ${teamRef(team.name)}`,
      { userId: request.userId },
      (at) => {
        this.#deps.teams.addMentor({
          id: uuid7(),
          teamId,
          userId: request.userId,
          role: 'CO_MENTOR',
          at,
        });
      },
    );
    return this.#reader.detail(context.actor, teamId);
  }

  end(context: TeamsContext, teamId: string, mentorId: string, version: number): TeamDetail {
    const team = this.#reader.requireWritable(teamId, version);
    assertCan(context.actor, 'team.manage_mentors', this.#reader.facts(context.actor, teamId));
    const row = this.#deps.teams.openMentors(teamId).find((mentor) => mentor.id === mentorId);
    // Never the primary: R95 hands that role over instead.
    if (row?.role !== 'CO_MENTOR') throw mentorNotFound();
    this.#audited(
      context,
      team,
      'team.mentor_ended',
      `A co-mentor stepped down from ${teamRef(team.name)}`,
      { userId: row.userId },
      (at) => {
        this.#deps.teams.endMentor(mentorId, at);
      },
    );
    return this.#reader.detail(context.actor, teamId);
  }

  transferPrimary(
    context: TeamsContext,
    teamId: string,
    request: TeamTransferPrimaryRequest,
  ): TeamDetail {
    const team = this.#reader.requireWritable(teamId, request.version);
    assertCan(context.actor, 'team.transfer_primary', this.#reader.facts(context.actor, teamId));
    if (!this.#deps.teams.isActiveProfessor(request.toUserId)) throw mentorNotProfessor();
    const open = this.#deps.teams.openMentors(teamId);
    const primary = open.find((row) => row.role === 'PRIMARY');
    if (primary?.userId === request.toUserId) {
      throw validationFailed([
        { path: 'body.toUserId', message: 'That professor is already the primary mentor.' },
      ]);
    }
    const target = open.find((row) => row.userId === request.toUserId);
    this.#audited(
      context,
      team,
      'team.primary_transferred',
      `Primary mentor of ${teamRef(team.name)} handed over`,
      { from: primary?.userId ?? null, to: request.toUserId, stepAway: request.stepAway },
      (at) => {
        if (primary !== undefined) this.#deps.teams.endMentor(primary.id, at);
        if (target !== undefined) this.#deps.teams.endMentor(target.id, at);
        this.#deps.teams.addMentor({
          id: uuid7(),
          teamId,
          userId: request.toUserId,
          role: 'PRIMARY',
          at,
        });
        if (primary !== undefined && !request.stepAway) {
          this.#deps.teams.addMentor({
            id: uuid7(),
            teamId,
            userId: primary.userId,
            role: 'CO_MENTOR',
            at,
          });
        }
      },
    );
    return this.#reader.detail(context.actor, teamId);
  }

  #audited(
    context: TeamsContext,
    team: TeamRecord,
    action: string,
    summary: string,
    diff: Record<string, unknown>,
    work: (at: number) => void,
  ): void {
    const at = nowMs(this.#clock);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action,
        entityKind: 'team',
        entityId: team.id,
        summary,
        diff,
        requestId: context.requestId ?? null,
      },
      () => {
        work(at);
        this.#deps.teams.touch(team.id, at);
      },
    );
  }
}
