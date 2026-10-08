import {
  ERASED_STUDENT_NAME,
  isEngagementMentor,
  isEngagementPrimaryMentor,
  type CompetitionDetail,
  type CompetitionEvent,
  type CompetitionListItem,
  type CompetitionMentor,
  type CompetitionParticipant,
  type EngagementStatus,
  type OutcomeResult,
  type OutcomeView,
  type OwnershipFacts,
  type ScheduleHealth,
  type WorkflowChoice,
  type TeamMentorship,
} from '@compintel/contracts';

import { allowedFrom, isTerminal } from '../../domain/engagements/status.js';
import type { AuditLog } from '../../platform/audit.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { can } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import type { TeamsRepository } from '../teams/repository.js';
import { competitionClosed, competitionNotFound, competitionVersionConflict } from './errors.js';
import type {
  CompetitionMentorRecord,
  EngagementRecord,
  EngagementsRepository,
  EventRecord,
  ParticipantRecord,
} from './repository.js';

/** Runs inside the transaction that enters ASSIGNED (R98); WP-20a's workflow copy is the first. */
export type OnAssignedHook = (assigned: {
  readonly engagementId: string;
  readonly eventId: string;
  readonly actorId: string;
  readonly at: number;
  /** WP-20a: the template chosen in the assign flow; absent → the type's default. */
  readonly workflow: WorkflowChoice | undefined;
}) => void;

/** One competition's workflow progress and schedule health (R99). */
export interface WorkflowSummary {
  readonly progress: number | null;
  readonly health: ScheduleHealth | null;
  readonly healthReason: string | null;
}

/** WP-20a: progress and health per competition, for the list and the board. */
export type WorkflowSummaries = (
  competitions: readonly { readonly id: string; readonly status: EngagementStatus }[],
) => ReadonlyMap<string, WorkflowSummary>;

/** WP-21: the outcomes module's answers, for the list's result and the page's panel. */
export interface OutcomeLookup {
  readonly results: (ids: readonly string[]) => ReadonlyMap<string, OutcomeResult>;
  readonly view: (id: string) => OutcomeView | null;
}

/** What every competitions service holds. */
export interface EngagementsDependencies {
  readonly engagements: EngagementsRepository;
  /** WP-18's teams: roster and mentors are copied from here at assignment. */
  readonly teams: TeamsRepository;
  readonly audit: AuditLog;
  readonly onAssigned: readonly OnAssignedHook[];
  readonly summaries?: WorkflowSummaries;
  readonly outcomes?: OutcomeLookup;
  readonly clock?: Clock;
}

export interface EngagementsContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

const iso = (at: number): string => new Date(at).toISOString();
const isoOrNull = (at: number | null): string | null => (at === null ? null : iso(at));

export const studentName = (row: { fullName: string; erasedAt: number | null }): string =>
  row.erasedAt === null ? row.fullName : ERASED_STUDENT_NAME;

/** "Team Rocket — HackXYZ 2026", or the student's name for an individual entry. */
export function competitionName(who: string, eventTitle: string): string {
  return `${who} — ${eventTitle}`;
}

export function toEvent(row: EventRecord): CompetitionEvent {
  return {
    id: row.id,
    title: row.title,
    eventType: row.eventType,
    registrationDeadlineAt: row.registrationDeadlineAt,
    registrationDeadlinePrecision: row.registrationDeadlinePrecision,
    startsAt: row.startsAt,
    datePrecision: row.datePrecision,
    endsAt: row.endsAt,
    timezone: row.timezone,
    cancellation: row.cancellation,
    teamMin: row.teamMin,
    teamMax: row.teamMax,
  };
}

function toParticipant(row: ParticipantRecord): CompetitionParticipant {
  return {
    studentId: row.studentId,
    fullName: studentName(row),
    universityId: row.universityId,
    studentStatus: row.studentStatus,
    roleLabel: row.roleLabel,
    addedAt: iso(row.addedAt),
    removedAt: isoOrNull(row.removedAt),
    removalReason: row.removalReason,
  };
}

function toMentor(row: CompetitionMentorRecord): CompetitionMentor {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    fromAt: iso(row.fromAt),
    toAt: isoOrNull(row.toAt),
  };
}

export function mentorshipOf(rows: readonly CompetitionMentorRecord[]): TeamMentorship {
  const open = rows.filter((row) => row.toAt === null);
  return {
    primaryUserId: open.find((row) => row.role === 'PRIMARY')?.userId ?? null,
    coMentorUserIds: open.filter((row) => row.role === 'CO_MENTOR').map((row) => row.userId),
  };
}

/**
 * Loading a competition, the facts R96 needs about the actor's relation to it,
 * and the list and page answers. Every competitions service goes through here,
 * so "not found", "closed", "stale version" and "may this user…" are decided once.
 */
export class EngagementReader {
  readonly #deps: EngagementsDependencies;
  readonly #clock: Clock;

  constructor(deps: EngagementsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  require(id: string): EngagementRecord {
    const row = this.#deps.engagements.find(id);
    if (row === undefined) throw competitionNotFound();
    return row;
  }

  /** For an edit: it exists, is at the client's version, and is not terminal (R97). */
  requireEditable(id: string, version: number): EngagementRecord {
    const row = this.require(id);
    if (row.version !== version) throw competitionVersionConflict();
    if (isTerminal(row.status)) throw competitionClosed(row.status);
    return row;
  }

  facts(actor: Principal, id: string): OwnershipFacts {
    const mentorship = mentorshipOf(this.#deps.engagements.openMentors(id));
    return {
      isCompetitionMentor: isEngagementMentor(actor, mentorship),
      isCompetitionPrimaryMentor: isEngagementPrimaryMentor(actor, mentorship),
    };
  }

  list(actor: Principal, rows: readonly EngagementRecord[]): CompetitionListItem[] {
    const ids = rows.map((row) => row.id);
    const events = new Map(
      this.#deps.engagements
        .events([...new Set(rows.map((row) => row.eventId))])
        .map((event) => [event.id, event]),
    );
    const participants = this.#deps.engagements.participants(ids);
    const mentors = this.#deps.engagements.mentors(ids);
    const deadlines = this.#deps.engagements.upcomingDeadlines(
      [...events.keys()],
      nowMs(this.#clock),
    );
    const summaries = this.#deps.summaries?.(rows) ?? new Map<string, WorkflowSummary>();
    const results =
      this.#deps.outcomes?.results(rows.map((row) => row.id)) ?? new Map<string, OutcomeResult>();
    return rows.flatMap((row) => {
      const event = events.get(row.eventId);
      if (event === undefined) return [];
      const roster = participants.filter((p) => p.engagementId === row.id);
      const open = mentors.filter((m) => m.engagementId === row.id && m.toAt === null);
      const mentorship = mentorshipOf(open);
      const facts: OwnershipFacts = {
        isCompetitionMentor: isEngagementMentor(actor, mentorship),
        isCompetitionPrimaryMentor: isEngagementPrimaryMentor(actor, mentorship),
      };
      const primary = open.find((m) => m.role === 'PRIMARY');
      const only = row.kind === 'INDIVIDUAL' ? roster[0] : undefined;
      const next = deadlines.find((deadline) => deadline.eventId === row.eventId);
      const editable = !isTerminal(row.status);
      return [
        {
          id: row.id,
          status: row.status,
          kind: row.kind,
          event: toEvent(event),
          team: row.teamId === null ? null : { id: row.teamId, name: row.teamName ?? '' },
          student: only === undefined ? null : { id: only.studentId, fullName: studentName(only) },
          primaryMentor:
            primary === undefined
              ? null
              : { userId: primary.userId, displayName: primary.displayName },
          rosterCount: roster.filter((p) => p.removedAt === null).length,
          nextDeadline:
            next === undefined ? null : { kind: next.kind, at: next.at, precision: next.precision },
          statusChangedAt: iso(row.statusChangedAt),
          isMine: open.some((m) => m.userId === actor.id),
          progress: summaries.get(row.id)?.progress ?? null,
          health: summaries.get(row.id)?.health ?? null,
          healthReason: summaries.get(row.id)?.healthReason ?? null,
          result: results.get(row.id) ?? null,
          can: {
            edit: editable && can(actor, 'competition.edit', facts),
            manageMentors: editable && can(actor, 'competition.manage_mentors', facts),
          },
          version: row.version,
        },
      ];
    });
  }

  detail(actor: Principal, id: string): CompetitionDetail {
    const row = this.require(id);
    const [item] = this.list(actor, [row]);
    if (item === undefined) throw competitionNotFound();
    const participants = this.#deps.engagements.participants([id]);
    const mentors = this.#deps.engagements.mentors([id]);
    return {
      ...item,
      outcome: this.#deps.outcomes?.view(id) ?? null,
      roster: participants.filter((p) => p.removedAt === null).map(toParticipant),
      pastRoster: participants.filter((p) => p.removedAt !== null).map(toParticipant),
      mentors: mentors.filter((m) => m.toAt === null).map(toMentor),
      pastMentors: mentors.filter((m) => m.toAt !== null).map(toMentor),
      history: this.#deps.engagements.history(id).map((change) => ({
        id: change.id,
        from: change.fromStatus,
        to: change.toStatus,
        changedBy: change.changedBy ?? 'The system',
        changedAt: iso(change.changedAt),
        note: change.note,
      })),
      notes: row.notes,
      createdAt: iso(row.createdAt),
      allowed: [...allowedFrom(row.status)],
    };
  }
}
