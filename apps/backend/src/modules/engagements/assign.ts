import {
  isTeamMentor,
  isTeamPrimaryMentor,
  type AssignConflict,
  type AssignPreview,
  type AssignRequest,
  type AssignResult,
  type MentorRole,
  type ParticipantKind,
  type RosterEntry,
} from '@compintel/contracts';

import { assignWarnings } from '../../domain/engagements/assign.js';
import { studentRef } from '../../domain/students/records.js';
import { withAudit } from '../../platform/audit.js';
import { forbidden, notFound } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan, can } from '../auth/policy.js';
import { studentNotFound } from '../students/errors.js';
import {
  mentorNotProfessor,
  studentNotActive,
  teamArchived,
  teamNotFound,
} from '../teams/errors.js';
import { mentorshipOf as teamMentorshipOf } from '../teams/reader.js';
import { emptyRoster, eventMerged, studentAlreadyActive, teamAlreadyAssigned } from './errors.js';
import {
  competitionName,
  EngagementReader,
  studentName,
  toEvent,
  type EngagementsContext,
  type EngagementsDependencies,
} from './reader.js';
import type { EventRecord } from './repository.js';

/**
 * The assign flow (R96, R98): one preview answers the review step — roster and
 * mentors to copy, A14 conflicts, warnings — and the assignment creates the
 * competition(s) from exactly that plan, in one transaction. Warnings never
 * block; conflicts and an empty roster do.
 */

interface Planned {
  readonly kind: ParticipantKind;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly roster: RosterEntry[];
  readonly mentors: { userId: string; displayName: string; role: MentorRole }[];
}

interface Plan {
  readonly event: EventRecord;
  readonly competitions: Planned[];
  readonly leftOut: RosterEntry[];
  readonly conflicts: AssignConflict[];
}

export class AssignService {
  readonly #deps: EngagementsDependencies;
  readonly #clock: Clock;
  readonly #reader: EngagementReader;

  constructor(deps: EngagementsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new EngagementReader(deps);
  }

  preview(context: EngagementsContext, request: AssignRequest): AssignPreview {
    const plan = this.#plan(context, request);
    const at = nowMs(this.#clock);
    const empty = plan.competitions.some((planned) => planned.roster.length === 0);
    return {
      event: toEvent(plan.event),
      competitions: plan.competitions.map((planned) => ({
        kind: planned.kind,
        teamName: planned.teamName,
        roster: planned.roster,
        mentors: planned.mentors,
      })),
      leftOut: plan.leftOut,
      conflicts: plan.conflicts,
      warnings: assignWarnings(
        {
          registrationDeadlineAt: plan.event.registrationDeadlineAt,
          cancellation: plan.event.cancellation,
          teamMin: plan.event.teamMin,
          teamMax: plan.event.teamMax,
          kind: plan.competitions[0]?.kind ?? 'TEAM',
          rosterSizes: plan.competitions.map((planned) => planned.roster.length),
        },
        at,
      ),
      canAssign: plan.conflicts.length === 0 && !empty,
    };
  }

  assign(context: EngagementsContext, request: AssignRequest): AssignResult {
    const plan = this.#plan(context, request);
    const clash = plan.conflicts[0];
    if (clash !== undefined) {
      throw studentAlreadyActive(clash.fullName, {
        id: clash.competitionId,
        name: clash.competitionName,
      });
    }
    if (plan.competitions.some((planned) => planned.roster.length === 0)) throw emptyRoster();
    const departmentId = this.#deps.teams.managingDepartmentId();
    if (departmentId === undefined) throw new Error('setup has not created a department yet');
    const at = nowMs(this.#clock);
    const status = request.initialStatus;
    const ids = this.#deps.audit.transaction(() =>
      plan.competitions.map((planned) => {
        const id = uuid7();
        withAudit(
          this.#deps.audit,
          {
            actorKind: 'USER',
            actorUserId: context.actor.id,
            action: 'competition.assigned',
            entityKind: 'competition',
            entityId: id,
            // R92: a student is named by reference, never by name.
            summary:
              planned.teamName === null
                ? `Assigned ${studentRef(planned.roster[0]?.studentId ?? '')} to “${plan.event.title}”`
                : `Assigned ${planned.teamName} to “${plan.event.title}”`,
            diff: {
              eventId: plan.event.id,
              teamId: planned.teamId,
              status,
              roster: planned.roster.map((entry) => studentRef(entry.studentId)),
              mentors: planned.mentors.map((mentor) => mentor.userId),
            },
            requestId: context.requestId ?? null,
          },
          () => {
            this.#write(context, plan.event.id, departmentId, planned, id, status, at);
          },
        );
        return id;
      }),
    );
    const rows = ids.flatMap((id) => {
      const row = this.#deps.engagements.find(id);
      return row === undefined ? [] : [row];
    });
    return { competitions: this.#reader.list(context.actor, rows) };
  }

  #write(
    context: EngagementsContext,
    eventId: string,
    departmentId: string,
    planned: Planned,
    id: string,
    status: AssignRequest['initialStatus'],
    at: number,
  ): void {
    const repo = this.#deps.engagements;
    repo.insert({
      id,
      departmentId,
      eventId,
      kind: planned.kind,
      teamId: planned.teamId,
      status,
      createdBy: context.actor.id,
      at,
    });
    repo.addHistory({
      id: uuid7(),
      engagementId: id,
      from: null,
      to: status,
      by: context.actor.id,
      at,
      note: null,
    });
    for (const entry of planned.roster) {
      repo.openParticipant({
        engagementId: id,
        studentId: entry.studentId,
        eventId,
        roleLabel: entry.roleLabel,
        at,
      });
    }
    for (const mentor of planned.mentors) {
      repo.addMentor({
        id: uuid7(),
        engagementId: id,
        userId: mentor.userId,
        role: mentor.role,
        at,
      });
    }
    if (status === 'ASSIGNED') {
      for (const hook of this.#deps.onAssigned) {
        hook({ engagementId: id, eventId, actorId: context.actor.id, at });
      }
    }
  }

  #event(eventId: string): EventRecord {
    const event = this.#deps.engagements.event(eventId);
    if (event === undefined) throw notFound('That event does not exist.');
    if (event.visibility === 'MERGED' && event.mergedIntoEventId !== null) {
      const survivor = this.#deps.engagements.event(event.mergedIntoEventId);
      throw eventMerged({ id: event.mergedIntoEventId, name: survivor?.title ?? 'another event' });
    }
    return event;
  }

  #plan(context: EngagementsContext, request: AssignRequest): Plan {
    const event = this.#event(request.eventId);
    const competitions =
      'teamId' in request ? [this.#teamPlan(context, event, request.teamId)] : [];
    const leftOut: RosterEntry[] = [];
    if ('teamId' in request) {
      const team = competitions[0];
      const members = this.#deps.teams
        .members([request.teamId])
        .filter((row) => row.leftAt === null)
        .filter((row) => !team?.roster.some((entry) => entry.studentId === row.studentId));
      leftOut.push(
        ...members.map((row) => ({
          studentId: row.studentId,
          fullName: studentName(row),
          universityId: row.universityId,
          roleLabel: row.roleLabel,
        })),
      );
    } else {
      competitions.push(...this.#studentPlans(context, request.studentIds, request.primaryUserId));
    }
    const everyone = competitions.flatMap((planned) => planned.roster);
    const conflicts = this.#deps.engagements
      .activeOn(
        event.id,
        everyone.map((entry) => entry.studentId),
      )
      .map((active) => {
        const name = competitionName(
          active.teamName ?? (active.kind === 'INDIVIDUAL' ? `${active.studentName}’s entry` : '?'),
          active.eventTitle,
        );
        const who = everyone.find((entry) => entry.studentId === active.studentId)?.fullName ?? '';
        return {
          studentId: active.studentId,
          fullName: who,
          competitionId: active.engagementId,
          competitionName: name,
          message: `${who} is already in ${name} for this event.`,
        };
      });
    return { event, competitions, leftOut, conflicts };
  }

  #teamPlan(context: EngagementsContext, event: EventRecord, teamId: string): Planned {
    const team = this.#deps.teams.find(teamId);
    if (team === undefined) throw teamNotFound();
    const mentorRows = this.#deps.teams.openMentors(teamId);
    const mentorship = teamMentorshipOf(mentorRows);
    assertCan(context.actor, 'competition.assign_team', {
      isTeamMentor: isTeamMentor(context.actor, mentorship),
      isTeamPrimaryMentor: isTeamPrimaryMentor(context.actor, mentorship),
    });
    if (team.status === 'ARCHIVED') throw teamArchived();
    const open = this.#deps.engagements.openForTeam(event.id, teamId);
    if (open !== undefined) {
      throw teamAlreadyAssigned({ id: open.id, name: competitionName(team.name, event.title) });
    }
    const roster = this.#deps.teams
      .members([teamId])
      .filter(
        (row) => row.leftAt === null && row.studentStatus === 'ACTIVE' && row.erasedAt === null,
      )
      .map((row) => ({
        studentId: row.studentId,
        fullName: row.fullName,
        universityId: row.universityId,
        roleLabel: row.roleLabel,
      }));
    return {
      kind: 'TEAM',
      teamId,
      teamName: team.name,
      roster,
      mentors: mentorRows.map((row) => ({
        userId: row.userId,
        displayName: row.displayName,
        role: row.role,
      })),
    };
  }

  #studentPlans(
    context: EngagementsContext,
    studentIds: readonly string[],
    primaryUserId: string | undefined,
  ): Planned[] {
    assertCan(context.actor, 'competition.assign_individual');
    const primary = primaryUserId ?? context.actor.id;
    // R96: only an administrator names someone else as the primary.
    if (primary !== context.actor.id && !can(context.actor, 'team.transfer_ownership')) {
      throw forbidden('Only an administrator can make someone else the primary mentor.');
    }
    if (!this.#deps.teams.isActiveProfessor(primary)) throw mentorNotProfessor();
    const displayName = this.#deps.engagements.userName(primary) ?? 'A professor';
    const names = this.#deps.engagements.students(studentIds);
    return [...new Set(studentIds)].map((studentId) => {
      const status = this.#deps.teams.studentStatus(studentId);
      const name = names.get(studentId);
      if (status === undefined || name === undefined) throw studentNotFound();
      if (status.status !== 'ACTIVE' || status.erasedAt !== null) throw studentNotActive();
      return {
        kind: 'INDIVIDUAL' as const,
        teamId: null,
        teamName: null,
        roster: [
          {
            studentId,
            fullName: studentName(name),
            universityId: name.universityId,
            roleLabel: null,
          },
        ],
        mentors: [{ userId: primary, displayName, role: 'PRIMARY' as const }],
      };
    });
  }
}
