import {
  ERASED_STUDENT_NAME,
  isTeamMentor,
  isTeamPrimaryMentor,
  type OwnershipFacts,
  type TeamDetail,
  type TeamMember,
  type TeamMentor,
  type TeamMentorship,
} from '@compintel/contracts';

import { coverage } from '../../domain/teams/coverage.js';
import type { AuditLog } from '../../platform/audit.js';
import type { Clock } from '../../platform/time.js';
import { can } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import type { CompetitionLinksRepository } from '../engagements/links-repo.js';
import type { RelationsRepository } from '../students/relations-repo.js';
import { studentNotFound } from '../students/errors.js';
import { studentNotActive, teamArchived, teamNotFound, teamVersionConflict } from './errors.js';
import type { MemberRecord, MentorRecord, TeamRecord, TeamsRepository } from './repository.js';

/** What every teams service holds. */
export interface TeamsDependencies {
  readonly teams: TeamsRepository;
  /** WP-17's tags: targets are SKILL tags, created on first use (R94). */
  readonly tags: RelationsRepository;
  readonly audit: AuditLog;
  /** WP-19: the team's competitions, and the archive rule. */
  readonly competitions: CompetitionLinksRepository;
  readonly clock?: Clock;
}

export interface TeamsContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

const iso = (at: number): string => new Date(at).toISOString();
const isoOrNull = (at: number | null): string | null => (at === null ? null : iso(at));

function toMember(row: MemberRecord, skills: readonly string[]): TeamMember {
  return {
    id: row.id,
    studentId: row.studentId,
    fullName: row.erasedAt === null ? row.fullName : ERASED_STUDENT_NAME,
    universityId: row.universityId,
    studentStatus: row.studentStatus,
    skills: [...skills],
    roleLabel: row.roleLabel,
    isLead: row.isLead === 1,
    joinedAt: iso(row.joinedAt),
    leftAt: isoOrNull(row.leftAt),
  };
}

function toMentor(row: MentorRecord): TeamMentor {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    fromAt: iso(row.fromAt),
    toAt: isoOrNull(row.toAt),
  };
}

/** The open mentor rows as the permission predicates read them. */
export function mentorshipOf(rows: readonly MentorRecord[]): TeamMentorship {
  const open = rows.filter((row) => row.toAt === null);
  return {
    primaryUserId: open.find((row) => row.role === 'PRIMARY')?.userId ?? null,
    coMentorUserIds: open.filter((row) => row.role === 'CO_MENTOR').map((row) => row.userId),
  };
}

/**
 * Loading a team, the facts §10.2 needs about the actor's relation to it, and
 * the page's whole answer. Every teams service goes through here, so "not
 * found", "archived", "stale version" and "may this user…" are decided once.
 */
export class TeamReader {
  readonly #deps: TeamsDependencies;

  constructor(deps: TeamsDependencies) {
    this.#deps = deps;
  }

  require(id: string): TeamRecord {
    const row = this.#deps.teams.find(id);
    if (row === undefined) throw teamNotFound();
    return row;
  }

  /** For a write: the team exists, is not archived (R95) and is at the version the client saw. */
  requireWritable(id: string, version: number): TeamRecord {
    const row = this.require(id);
    if (row.status === 'ARCHIVED') throw teamArchived();
    if (row.version !== version) throw teamVersionConflict();
    return row;
  }

  /** R95: only ACTIVE students join; an unknown one is a 404. */
  requireJoinable(studentId: string): void {
    const student = this.#deps.teams.studentStatus(studentId);
    if (student === undefined) throw studentNotFound();
    if (student.status !== 'ACTIVE' || student.erasedAt !== null) throw studentNotActive();
  }

  facts(actor: Principal, teamId: string): OwnershipFacts {
    const mentorship = mentorshipOf(this.#deps.teams.openMentors(teamId));
    return {
      isTeamMentor: isTeamMentor(actor, mentorship),
      isTeamPrimaryMentor: isTeamPrimaryMentor(actor, mentorship),
    };
  }

  detail(actor: Principal, id: string): TeamDetail {
    const team = this.require(id);
    const members = this.#deps.teams.members([id]);
    const mentors = this.#deps.teams.mentors([id]);
    const open = members.filter((row) => row.leftAt === null);
    const holdings = this.#deps.teams.skillsOf(open.map((row) => row.studentId));
    const skillsOf = (studentId: string) => holdings.filter((held) => held.studentId === studentId);
    const targets = this.#deps.teams.targets(id);
    const facts = this.facts(actor, id);
    const active = team.status === 'ACTIVE';
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      status: team.status,
      createdAt: iso(team.createdAt),
      members: open.map((row) =>
        toMember(
          row,
          skillsOf(row.studentId).map((held) => held.name),
        ),
      ),
      pastMembers: members.filter((row) => row.leftAt !== null).map((row) => toMember(row, [])),
      mentors: mentors.filter((row) => row.toAt === null).map(toMentor),
      pastMentors: mentors.filter((row) => row.toAt !== null).map(toMentor),
      competitions: this.#deps.competitions.ofTeam(id),
      targets,
      coverage: coverage(
        open.map((row) => ({
          active: row.studentStatus === 'ACTIVE' && row.erasedAt === null,
          skills: skillsOf(row.studentId),
        })),
        targets,
      ),
      can: {
        edit: active && can(actor, 'team.edit', facts),
        archive: can(actor, 'team.archive', facts),
        manageMentors: active && can(actor, 'team.manage_mentors', facts),
        transferPrimary: active && can(actor, 'team.transfer_primary', facts),
      },
      version: team.version,
    };
  }
}
