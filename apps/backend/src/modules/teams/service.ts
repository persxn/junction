import type {
  ProfessorList,
  TeamCreateRequest,
  TeamDetail,
  TeamListQuery,
  TeamListResponse,
  TeamUpdateRequest,
} from '@compintel/contracts';

import { studentRef } from '../../domain/students/records.js';
import { coverage, teamNameKey, teamRef } from '../../domain/teams/coverage.js';
import { withAudit } from '../../platform/audit.js';
import { conflict, forbidden } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan, can } from '../auth/policy.js';
import {
  leadNotMember,
  memberExists,
  mentorNotProfessor,
  teamNameTaken,
  teamVersionConflict,
} from './errors.js';
import { TeamReader, type TeamsContext, type TeamsDependencies } from './reader.js';

/**
 * Team records (§6.2, §10.2, R94–R95): the list, the page, create, edit,
 * archive. Members and mentors have their own services; all three share the
 * reader, so loading and permission facts are decided one way.
 */

const blankToNull = (value: string | null | undefined): string | null | undefined =>
  value === undefined ? undefined : value === null || value.trim() === '' ? null : value.trim();

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export class TeamsService {
  readonly #deps: TeamsDependencies;
  readonly #clock: Clock;
  readonly #reader: TeamReader;

  constructor(deps: TeamsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new TeamReader(deps);
  }

  list(context: TeamsContext, query: TeamListQuery): TeamListResponse {
    assertCan(context.actor, 'team.view');
    const rows = this.#deps.teams.list(query, context.actor.id);
    const members = this.#deps.teams
      .members(rows.map((row) => row.id))
      .filter((row) => row.leftAt === null);
    const holdings = this.#deps.teams.skillsOf([...new Set(members.map((row) => row.studentId))]);
    const items = rows.map((row) => {
      const open = members.filter((member) => member.teamId === row.id);
      const counts = coverage(
        open.map((member) => ({
          active: member.studentStatus === 'ACTIVE' && member.erasedAt === null,
          skills: holdings.filter((held) => held.studentId === member.studentId),
        })),
        this.#deps.teams.targets(row.id),
      ).counts;
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        memberCount: row.memberCount,
        primaryMentor:
          row.primaryUserId === null || row.primaryName === null
            ? null
            : { userId: row.primaryUserId, displayName: row.primaryName },
        coverage: counts,
        isMine: row.mine === 1,
        version: row.version,
      };
    });
    return { items, total: items.length };
  }

  get(context: TeamsContext, id: string): TeamDetail {
    assertCan(context.actor, 'team.view');
    return this.#reader.detail(context.actor, id);
  }

  professors(context: TeamsContext): ProfessorList {
    assertCan(context.actor, 'team.view');
    return { professors: this.#deps.teams.professors() };
  }

  create(context: TeamsContext, request: TeamCreateRequest): TeamDetail {
    assertCan(context.actor, 'team.create');
    const primaryUserId = request.primaryUserId ?? context.actor.id;
    // R95: only an administrator names someone else as the primary.
    if (primaryUserId !== context.actor.id && !can(context.actor, 'team.transfer_ownership')) {
      throw forbidden('Only an administrator can make someone else the primary mentor.');
    }
    if (!this.#deps.teams.isActiveProfessor(primaryUserId)) throw mentorNotProfessor();
    const departmentId = this.#deps.teams.managingDepartmentId();
    if (departmentId === undefined) throw new Error('setup has not created a department yet');
    const name = request.name.trim().replace(/\s+/g, ' ');
    const nameKey = teamNameKey(name);
    if (this.#deps.teams.nameTaken(departmentId, nameKey, null)) throw teamNameTaken(name);
    if (request.members.filter((member) => member.isLead === true).length > 1)
      throw leadNotMember();
    const studentIds = request.members.map((member) => member.studentId);
    if (new Set(studentIds).size !== studentIds.length) throw memberExists();
    for (const studentId of studentIds) this.#reader.requireJoinable(studentId);

    const id = uuid7();
    const at = nowMs(this.#clock);
    try {
      withAudit(
        this.#deps.audit,
        {
          actorKind: 'USER',
          actorUserId: context.actor.id,
          action: 'team.created',
          entityKind: 'team',
          entityId: id,
          summary: `Created ${teamRef(name)}`,
          diff: {
            primaryUserId,
            members: studentIds.map(studentRef),
            targets: request.targets,
          },
          requestId: context.requestId ?? null,
        },
        () => {
          this.#deps.teams.insert({
            id,
            departmentId,
            name,
            nameKey,
            description: blankToNull(request.description) ?? null,
            status: 'ACTIVE',
            createdAt: at,
            createdBy: context.actor.id,
            version: 1,
          });
          this.#deps.teams.addMentor({
            id: uuid7(),
            teamId: id,
            userId: primaryUserId,
            role: 'PRIMARY',
            at,
          });
          for (const member of request.members) {
            this.#deps.teams.addMember({
              id: uuid7(),
              teamId: id,
              studentId: member.studentId,
              roleLabel: blankToNull(member.roleLabel) ?? null,
              isLead: member.isLead === true,
              at,
            });
          }
          this.#deps.teams.setTargets(
            id,
            request.targets.map((target) => this.#deps.tags.ensureTag('SKILL', target, at)),
          );
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw teamNameTaken(name);
      throw error;
    }
    return this.#reader.detail(context.actor, id);
  }

  update(context: TeamsContext, id: string, request: TeamUpdateRequest): TeamDetail {
    const team = this.#reader.requireWritable(id, request.version);
    assertCan(context.actor, 'team.edit', this.#reader.facts(context.actor, id));
    const name = request.name?.trim().replace(/\s+/g, ' ');
    const nameKey = name === undefined ? undefined : teamNameKey(name);
    if (
      name !== undefined &&
      nameKey !== team.nameKey &&
      this.#deps.teams.nameTaken(team.departmentId, nameKey ?? '', id)
    ) {
      throw teamNameTaken(name);
    }
    const description = blankToNull(request.description);
    const at = nowMs(this.#clock);
    const changed: Record<string, unknown> = {};
    if (name !== undefined && name !== team.name) changed.name = name;
    if (description !== undefined && description !== team.description)
      changed.description = description;
    if (request.targets !== undefined) changed.targets = request.targets;
    try {
      withAudit(
        this.#deps.audit,
        {
          actorKind: 'USER',
          actorUserId: context.actor.id,
          action: 'team.updated',
          entityKind: 'team',
          entityId: id,
          summary: `Edited ${teamRef(name ?? team.name)}`,
          diff: changed,
          requestId: context.requestId ?? null,
        },
        () => {
          this.#deps.teams.touch(id, at, {
            ...(name === undefined || nameKey === undefined || changed.name === undefined
              ? {}
              : { name, nameKey }),
            ...(description === undefined ? {} : { description }),
          });
          if (request.targets !== undefined) {
            this.#deps.teams.setTargets(
              id,
              request.targets.map((target) => this.#deps.tags.ensureTag('SKILL', target, at)),
            );
          }
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw teamNameTaken(name ?? team.name);
      throw error;
    }
    return this.#reader.detail(context.actor, id);
  }

  /** R95: archive keeps every row open and makes the team read-only. */
  archive(context: TeamsContext, id: string, version: number): TeamDetail {
    const team = this.#reader.requireWritable(id, version);
    assertCan(context.actor, 'team.archive', this.#reader.facts(context.actor, id));
    this.#setStatus(context, id, 'ARCHIVED', `Archived ${teamRef(team.name)}`);
    return this.#reader.detail(context.actor, id);
  }

  /** R95: unarchive refuses a name an active team now holds. */
  unarchive(context: TeamsContext, id: string, version: number): TeamDetail {
    const team = this.#reader.require(id);
    if (team.version !== version) throw teamVersionConflict();
    if (team.status !== 'ARCHIVED') throw conflict('This team is not archived.');
    assertCan(context.actor, 'team.archive', this.#reader.facts(context.actor, id));
    if (this.#deps.teams.nameTaken(team.departmentId, team.nameKey, id))
      throw teamNameTaken(team.name);
    try {
      this.#setStatus(context, id, 'ACTIVE', `Unarchived ${teamRef(team.name)}`);
    } catch (error) {
      if (isUniqueViolation(error)) throw teamNameTaken(team.name);
      throw error;
    }
    return this.#reader.detail(context.actor, id);
  }

  #setStatus(
    context: TeamsContext,
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    summary: string,
  ): void {
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: status === 'ARCHIVED' ? 'team.archived' : 'team.unarchived',
        entityKind: 'team',
        entityId: id,
        summary,
        diff: { status },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.teams.touch(id, nowMs(this.#clock), { status });
      },
    );
  }
}
