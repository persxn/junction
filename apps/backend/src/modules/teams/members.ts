import type {
  TeamAddMemberRequest,
  TeamDetail,
  TeamUpdateMemberRequest,
} from '@compintel/contracts';

import { studentRef } from '../../domain/students/records.js';
import { teamRef } from '../../domain/teams/coverage.js';
import { withAudit } from '../../platform/audit.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import { leadNotMember, memberExists, memberNotFound } from './errors.js';
import { TeamReader, type TeamsContext, type TeamsDependencies } from './reader.js';
import type { MemberRecord, TeamRecord } from './repository.js';

/**
 * A team's members (§10.2 "Edit a team": primary or co-mentor; R95).
 *
 * Joining opens a row; leaving closes it — a rejoin opens a new one, so the
 * history of who was in the team when stays. The role label and the lead are
 * edited in place; at most one open lead, and making a lead clears the old one
 * in the same transaction. Every change bumps the team's version, and the audit
 * names the student as "student 01a0…", never by name (R92).
 */

const blankToNull = (value: string | null | undefined): string | null | undefined =>
  value === undefined ? undefined : value === null || value.trim() === '' ? null : value.trim();

export class TeamMembersService {
  readonly #deps: TeamsDependencies;
  readonly #clock: Clock;
  readonly #reader: TeamReader;

  constructor(deps: TeamsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new TeamReader(deps);
  }

  add(context: TeamsContext, teamId: string, request: TeamAddMemberRequest): TeamDetail {
    const team = this.#writable(context, teamId, request.version);
    this.#reader.requireJoinable(request.studentId);
    if (this.#deps.teams.openMembership(teamId, request.studentId)) throw memberExists();
    const at = nowMs(this.#clock);
    const id = uuid7();
    const roleLabel = blankToNull(request.roleLabel) ?? null;
    this.#audited(
      context,
      team,
      'team.member_added',
      `Added ${studentRef(request.studentId)} to ${teamRef(team.name)}`,
      {
        student: studentRef(request.studentId),
        roleLabel,
        isLead: request.isLead === true,
      },
      () => {
        if (request.isLead === true) this.#deps.teams.clearLead(teamId);
        this.#deps.teams.addMember({
          id,
          teamId,
          studentId: request.studentId,
          roleLabel,
          isLead: request.isLead === true,
          at,
        });
      },
    );
    return this.#reader.detail(context.actor, teamId);
  }

  update(
    context: TeamsContext,
    teamId: string,
    memberId: string,
    request: TeamUpdateMemberRequest,
  ): TeamDetail {
    const team = this.#writable(context, teamId, request.version);
    const member = this.#member(teamId, memberId, request.isLead === true);
    const roleLabel = blankToNull(request.roleLabel);
    const changed: Record<string, unknown> = {};
    if (roleLabel !== undefined && roleLabel !== member.roleLabel) changed.roleLabel = roleLabel;
    if (request.isLead !== undefined && request.isLead !== (member.isLead === 1))
      changed.isLead = request.isLead;
    this.#audited(
      context,
      team,
      'team.member_updated',
      `Changed ${studentRef(member.studentId)} in ${teamRef(team.name)}`,
      changed,
      () => {
        if (request.isLead === true) this.#deps.teams.clearLead(teamId);
        this.#deps.teams.updateMember(memberId, {
          ...(roleLabel === undefined ? {} : { roleLabel }),
          ...(request.isLead === undefined ? {} : { isLead: request.isLead }),
        });
      },
    );
    return this.#reader.detail(context.actor, teamId);
  }

  leave(context: TeamsContext, teamId: string, memberId: string, version: number): TeamDetail {
    const team = this.#writable(context, teamId, version);
    const member = this.#member(teamId, memberId, false);
    this.#audited(
      context,
      team,
      'team.member_left',
      `${studentRef(member.studentId)} left ${teamRef(team.name)}`,
      {
        student: studentRef(member.studentId),
        wasLead: member.isLead === 1,
      },
      () => {
        this.#deps.teams.leave(memberId, nowMs(this.#clock));
      },
    );
    return this.#reader.detail(context.actor, teamId);
  }

  #writable(context: TeamsContext, teamId: string, version: number): TeamRecord {
    const team = this.#reader.requireWritable(teamId, version);
    assertCan(context.actor, 'team.edit', this.#reader.facts(context.actor, teamId));
    return team;
  }

  /** An open membership of this team; a closed one cannot become the lead. */
  #member(teamId: string, memberId: string, makingLead: boolean): MemberRecord {
    const member = this.#deps.teams.member(memberId);
    if (member?.teamId !== teamId) throw memberNotFound();
    if (member.leftAt !== null) throw makingLead ? leadNotMember() : memberNotFound();
    return member;
  }

  #audited(
    context: TeamsContext,
    team: TeamRecord,
    action: string,
    summary: string,
    diff: Record<string, unknown>,
    work: () => void,
  ): void {
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
        work();
        this.#deps.teams.touch(team.id, nowMs(this.#clock));
      },
    );
  }
}
