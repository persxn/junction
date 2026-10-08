import type {
  AddParticipantRequest,
  CompetitionAddMentorRequest,
  CompetitionDetail,
  CompetitionTransferRequest,
} from '@compintel/contracts';

import { studentRef } from '../../domain/students/records.js';
import { withAudit, type AuditEntry } from '../../platform/audit.js';
import { conflict } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import { studentNotFound } from '../students/errors.js';
import { mentorNotProfessor, studentNotActive } from '../teams/errors.js';
import {
  competitionMentorExists,
  competitionMentorNotFound,
  participantNotFound,
  studentAlreadyActive,
} from './errors.js';
import {
  competitionName,
  EngagementReader,
  studentName,
  type EngagementsContext,
  type EngagementsDependencies,
} from './reader.js';
import type { EngagementRecord } from './repository.js';

/**
 * A competition's people after assignment (R96–R97): the roster, frozen at
 * assignment and edited here explicitly, and the competition's own mentors —
 * one PRIMARY, handed over rather than ended, and any co-mentors.
 */

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export class CompetitionPeopleService {
  readonly #deps: EngagementsDependencies;
  readonly #clock: Clock;
  readonly #reader: EngagementReader;

  constructor(deps: EngagementsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new EngagementReader(deps);
  }

  addParticipant(
    context: EngagementsContext,
    id: string,
    request: AddParticipantRequest,
  ): CompetitionDetail {
    const row = this.#editable(context, id, request.version, 'competition.edit');
    const status = this.#deps.teams.studentStatus(request.studentId);
    const student = this.#deps.engagements.students([request.studentId]).get(request.studentId);
    if (status === undefined || student === undefined) throw studentNotFound();
    if (status.status !== 'ACTIVE' || status.erasedAt !== null) throw studentNotActive();
    const clash = this.#deps.engagements.activeOn(row.eventId, [request.studentId])[0];
    if (clash !== undefined) {
      const name = competitionName(
        clash.teamName ?? `${clash.studentName}’s entry`,
        clash.eventTitle,
      );
      throw studentAlreadyActive(studentName(student), { id: clash.engagementId, name });
    }
    const roleLabel =
      request.roleLabel === undefined || request.roleLabel === null || request.roleLabel === ''
        ? null
        : request.roleLabel;
    try {
      this.#audited(context, row, {
        action: 'competition.participant_added',
        summary: `Added ${studentRef(request.studentId)} to a competition’s roster`,
        diff: { studentId: studentRef(request.studentId), roleLabel },
        work: (at) => {
          this.#deps.engagements.openParticipant({
            engagementId: id,
            studentId: request.studentId,
            eventId: row.eventId,
            roleLabel,
            at,
          });
        },
      });
    } catch (error) {
      // A14's index, if another write got there between the check and the insert.
      if (isUniqueViolation(error)) {
        throw studentAlreadyActive(studentName(student), {
          id: row.id,
          name: 'another competition',
        });
      }
      throw error;
    }
    return this.#reader.detail(context.actor, id);
  }

  removeParticipant(
    context: EngagementsContext,
    id: string,
    studentId: string,
    version: number,
  ): CompetitionDetail {
    const row = this.#editable(context, id, version, 'competition.edit');
    const open = this.#deps.engagements
      .participants([id])
      .find((p) => p.studentId === studentId && p.removedAt === null);
    if (open === undefined) throw participantNotFound();
    this.#audited(context, row, {
      action: 'competition.participant_removed',
      summary: `Removed ${studentRef(studentId)} from a competition’s roster`,
      diff: { studentId: studentRef(studentId) },
      work: (at) => {
        this.#deps.engagements.closeParticipant(id, studentId, at, 'REMOVED');
      },
    });
    return this.#reader.detail(context.actor, id);
  }

  addMentor(
    context: EngagementsContext,
    id: string,
    request: CompetitionAddMentorRequest,
  ): CompetitionDetail {
    const row = this.#editable(context, id, request.version, 'competition.manage_mentors');
    if (!this.#deps.teams.isActiveProfessor(request.userId)) throw mentorNotProfessor();
    if (this.#deps.engagements.openMentors(id).some((m) => m.userId === request.userId)) {
      throw competitionMentorExists();
    }
    this.#audited(context, row, {
      action: 'competition.mentor_added',
      summary: 'Added a co-mentor to a competition',
      diff: { userId: request.userId },
      work: (at) => {
        this.#deps.engagements.addMentor({
          id: uuid7(),
          engagementId: id,
          userId: request.userId,
          role: 'CO_MENTOR',
          at,
        });
      },
    });
    return this.#reader.detail(context.actor, id);
  }

  endMentor(
    context: EngagementsContext,
    id: string,
    mentorId: string,
    version: number,
  ): CompetitionDetail {
    const row = this.#editable(context, id, version, 'competition.manage_mentors');
    const mentor = this.#deps.engagements.openMentors(id).find((m) => m.id === mentorId);
    if (mentor?.role !== 'CO_MENTOR') throw competitionMentorNotFound();
    this.#audited(context, row, {
      action: 'competition.mentor_ended',
      summary: 'A co-mentor stepped down from a competition',
      diff: { userId: mentor.userId },
      work: (at) => {
        this.#deps.engagements.endMentor(mentorId, at);
      },
    });
    return this.#reader.detail(context.actor, id);
  }

  transferPrimary(
    context: EngagementsContext,
    id: string,
    request: CompetitionTransferRequest,
  ): CompetitionDetail {
    const row = this.#editable(context, id, request.version, 'competition.transfer_primary');
    if (!this.#deps.teams.isActiveProfessor(request.toUserId)) throw mentorNotProfessor();
    const open = this.#deps.engagements.openMentors(id);
    const primary = open.find((m) => m.role === 'PRIMARY');
    if (primary === undefined) throw new Error('a competition without a primary mentor');
    if (primary.userId === request.toUserId) {
      throw conflict('That professor is already the primary mentor.');
    }
    const target = open.find((m) => m.userId === request.toUserId);
    this.#audited(context, row, {
      action: 'competition.primary_transferred',
      summary: 'Handed a competition to another primary mentor',
      diff: { from: primary.userId, to: request.toUserId, stepAway: request.stepAway },
      work: (at) => {
        const repo = this.#deps.engagements;
        repo.endMentor(primary.id, at);
        if (target !== undefined) repo.endMentor(target.id, at);
        repo.addMentor({
          id: uuid7(),
          engagementId: id,
          userId: request.toUserId,
          role: 'PRIMARY',
          at,
        });
        if (!request.stepAway) {
          repo.addMentor({
            id: uuid7(),
            engagementId: id,
            userId: primary.userId,
            role: 'CO_MENTOR',
            at,
          });
        }
      },
    });
    return this.#reader.detail(context.actor, id);
  }

  #editable(
    context: EngagementsContext,
    id: string,
    version: number,
    action: 'competition.edit' | 'competition.manage_mentors' | 'competition.transfer_primary',
  ): EngagementRecord {
    this.#reader.require(id);
    assertCan(context.actor, action, this.#reader.facts(context.actor, id));
    return this.#reader.requireEditable(id, version);
  }

  #audited(
    context: EngagementsContext,
    row: EngagementRecord,
    change: {
      action: string;
      summary: string;
      diff: NonNullable<AuditEntry['diff']>;
      work: (at: number) => void;
    },
  ): void {
    const at = nowMs(this.#clock);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: change.action,
        entityKind: 'competition',
        entityId: row.id,
        summary: change.summary,
        diff: change.diff,
        requestId: context.requestId ?? null,
      },
      () => {
        change.work(at);
        this.#deps.engagements.touch(row.id, at);
      },
    );
  }
}
