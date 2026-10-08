import { z } from 'zod';

import { DatePrecision, EventType } from './enums.js';
import { Cancellation, DeadlineKind } from './events.js';
import { EngagementStatus, ParticipantKind } from './engagement-status.js';
import { Uuid7 } from './ids.js';
import { StudentStatus } from './student-status.js';
import { MentorRole, TeamPerson } from './teams.js';

/**
 * Competitions (§6.2 table `engagements`, UI label "Competition"; rulings
 * R96–R98, roadmap WP-19): an event taken on by a team or by one student, its
 * status machine, its frozen roster and mentors, and the assign flow.
 *
 * The UI never says "engagement"; the API path is `/competitions`.
 */

/**
 * R97's machine, as data: from each status, where it may go. COMPLETED,
 * WITHDRAWN and NOT_SELECTED go nowhere — they are terminal and read-only.
 */
export const ENGAGEMENT_TRANSITIONS: Readonly<
  Record<EngagementStatus, readonly EngagementStatus[]>
> = {
  CONSIDERING: ['ASSIGNED', 'WITHDRAWN'],
  ASSIGNED: ['APPLIED', 'CONSIDERING', 'WITHDRAWN'],
  APPLIED: ['PARTICIPATING', 'NOT_SELECTED', 'WITHDRAWN'],
  PARTICIPATING: ['COMPLETED', 'WITHDRAWN'],
  COMPLETED: [],
  WITHDRAWN: [],
  NOT_SELECTED: [],
};

/** The board's columns, left to right; the terminal "closed" states are not columns. */
export const PIPELINE_COLUMNS = [
  'CONSIDERING',
  'ASSIGNED',
  'APPLIED',
  'PARTICIPATING',
  'COMPLETED',
] as const satisfies readonly EngagementStatus[];

/** Entering these closes the roster (R97) and frees the students for the event. */
export const CLOSING_STATUSES = [
  'WITHDRAWN',
  'NOT_SELECTED',
] as const satisfies readonly EngagementStatus[];

export const REMOVAL_REASONS = ['REMOVED', 'ENGAGEMENT_CLOSED'] as const;
export const RemovalReason = z.enum(REMOVAL_REASONS);
export type RemovalReason = z.infer<typeof RemovalReason>;

export const REMOVAL_REASON_LABELS: Readonly<Record<RemovalReason, string>> = {
  REMOVED: 'Removed from the roster',
  ENGAGEMENT_CLOSED: 'Released when the competition closed',
};

export const COMPETITION_NOTES_MAX = 4000;
export const COMPETITION_STUDENTS_MAX = 50;
export const DEADLINE_WINDOWS = [7, 14, 30] as const;

const Version = z.int().min(1);
const RoleLabel = z.string().trim().max(40).nullish();

/** The event, as a competition shows it: dates keep their precision (ADR-0015). */
export const CompetitionEvent = z
  .object({
    id: Uuid7,
    title: z.string().min(1),
    eventType: EventType,
    registrationDeadlineAt: z.int().nullable(),
    registrationDeadlinePrecision: DatePrecision,
    startsAt: z.int().nullable(),
    datePrecision: DatePrecision,
    endsAt: z.int().nullable(),
    timezone: z.string().nullable(),
    cancellation: Cancellation,
    teamMin: z.int().nullable(),
    teamMax: z.int().nullable(),
  })
  .strict();
export type CompetitionEvent = z.infer<typeof CompetitionEvent>;

/** The next date that still lies ahead, for the card's countdown (§12). */
export const NextDeadline = z
  .object({ kind: DeadlineKind, at: z.int(), precision: DatePrecision })
  .strict();
export type NextDeadline = z.infer<typeof NextDeadline>;

export const CompetitionParticipant = z
  .object({
    studentId: Uuid7,
    fullName: z.string().min(1),
    universityId: z.string().min(1),
    studentStatus: StudentStatus,
    roleLabel: z.string().nullable(),
    addedAt: z.iso.datetime(),
    removedAt: z.iso.datetime().nullable(),
    removalReason: RemovalReason.nullable(),
  })
  .strict();
export type CompetitionParticipant = z.infer<typeof CompetitionParticipant>;

export const CompetitionMentor = z
  .object({
    id: Uuid7,
    userId: Uuid7,
    displayName: z.string().min(1),
    role: MentorRole,
    fromAt: z.iso.datetime(),
    toAt: z.iso.datetime().nullable(),
  })
  .strict();
export type CompetitionMentor = z.infer<typeof CompetitionMentor>;

export const StatusChange = z
  .object({
    id: Uuid7,
    from: EngagementStatus.nullable(),
    to: EngagementStatus,
    changedBy: z.string().min(1),
    changedAt: z.iso.datetime(),
    note: z.string().nullable(),
  })
  .strict();
export type StatusChange = z.infer<typeof StatusChange>;

/** What the caller may do — cosmetic, the server decides again (§10.1). */
export const CompetitionAbilities = z
  .object({ edit: z.boolean(), manageMentors: z.boolean() })
  .strict();
export type CompetitionAbilities = z.infer<typeof CompetitionAbilities>;

const TeamRef = z.object({ id: Uuid7, name: z.string().min(1) }).strict();
const StudentRef = z.object({ id: Uuid7, fullName: z.string().min(1) }).strict();

export const CompetitionListItem = z
  .object({
    id: Uuid7,
    status: EngagementStatus,
    kind: ParticipantKind,
    event: CompetitionEvent,
    team: TeamRef.nullable(),
    /** The one student of an INDIVIDUAL competition. */
    student: StudentRef.nullable(),
    primaryMentor: TeamPerson.nullable(),
    rosterCount: z.int().min(0),
    nextDeadline: NextDeadline.nullable(),
    statusChangedAt: z.iso.datetime(),
    isMine: z.boolean(),
    can: CompetitionAbilities,
    version: Version,
  })
  .strict();
export type CompetitionListItem = z.infer<typeof CompetitionListItem>;

export const CompetitionDetail = CompetitionListItem.extend({
  roster: z.array(CompetitionParticipant),
  pastRoster: z.array(CompetitionParticipant),
  mentors: z.array(CompetitionMentor),
  pastMentors: z.array(CompetitionMentor),
  history: z.array(StatusChange),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Where the status may go next (R97), so the UI never offers a refused move. */
  allowed: z.array(EngagementStatus),
}).strict();
export type CompetitionDetail = z.infer<typeof CompetitionDetail>;

const commaList = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').filter((part) => part !== '') : value),
    z.array(item),
  );

export const CompetitionQuery = z
  .object({
    status: commaList(EngagementStatus).optional(),
    teamId: Uuid7.optional(),
    studentId: Uuid7.optional(),
    eventId: Uuid7.optional(),
    /** `me`, or a professor's id. */
    mentorId: z.union([z.literal('me'), Uuid7]).optional(),
    eventTypes: commaList(EventType).optional(),
    deadlineWithinDays: z.coerce
      .number()
      .refine((days) => (DEADLINE_WINDOWS as readonly number[]).includes(days))
      .optional(),
    /** WITHDRAWN and NOT_SELECTED are left out unless asked for. */
    includeClosed: z
      .union([z.boolean(), z.enum(['true', 'false']).transform((text) => text === 'true')])
      .optional(),
  })
  .strict();
export type CompetitionQuery = z.infer<typeof CompetitionQuery>;
export type CompetitionQueryInput = z.input<typeof CompetitionQuery>;

export const CompetitionListResponse = z
  .object({ items: z.array(CompetitionListItem), total: z.int().min(0) })
  .strict();
export type CompetitionListResponse = z.infer<typeof CompetitionListResponse>;

/** The statuses a competition may be created at (R98). */
export const INITIAL_STATUSES = ['ASSIGNED', 'CONSIDERING'] as const;
export const InitialStatus = z.enum(INITIAL_STATUSES);
export type InitialStatus = z.infer<typeof InitialStatus>;

/** Who takes the event on: one team, or one INDIVIDUAL competition per student (R96). */
export const TeamAssignRequest = z
  .object({ eventId: Uuid7, teamId: Uuid7, initialStatus: InitialStatus.default('ASSIGNED') })
  .strict();
export const StudentsAssignRequest = z
  .object({
    eventId: Uuid7,
    studentIds: z.array(Uuid7).min(1).max(COMPETITION_STUDENTS_MAX),
    /** An administrator names the primary; a professor is the primary themself. */
    primaryUserId: Uuid7.optional(),
    initialStatus: InitialStatus.default('ASSIGNED'),
  })
  .strict();
/** One request for both the preview and the assignment. */
export const AssignRequest = z.union([TeamAssignRequest, StudentsAssignRequest]);
export type AssignRequest = z.infer<typeof AssignRequest>;
export type AssignRequestInput = z.input<typeof AssignRequest>;

export const ASSIGN_WARNING_CODES = [
  'REGISTRATION_CLOSED',
  'REGISTRATION_CLOSING',
  'EVENT_CANCELLED',
  'EVENT_POSTPONED',
  'TEAM_TOO_SMALL',
  'TEAM_TOO_LARGE',
] as const;
export const AssignWarningCode = z.enum(ASSIGN_WARNING_CODES);
export type AssignWarningCode = z.infer<typeof AssignWarningCode>;

export const AssignWarning = z
  .object({ code: AssignWarningCode, message: z.string().min(1) })
  .strict();
export type AssignWarning = z.infer<typeof AssignWarning>;

/** An A14 clash: this student is already active in another competition on the event. */
export const AssignConflict = z
  .object({
    studentId: Uuid7,
    fullName: z.string().min(1),
    competitionId: Uuid7,
    /** "Team Rocket — HackXYZ 2026". */
    competitionName: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type AssignConflict = z.infer<typeof AssignConflict>;

export const RosterEntry = z
  .object({
    studentId: Uuid7,
    fullName: z.string().min(1),
    universityId: z.string().min(1),
    roleLabel: z.string().nullable(),
  })
  .strict();
export type RosterEntry = z.infer<typeof RosterEntry>;

export const AssignPreview = z
  .object({
    event: CompetitionEvent,
    /** One per competition the request would create (several for students). */
    competitions: z.array(
      z
        .object({
          kind: ParticipantKind,
          teamName: z.string().nullable(),
          roster: z.array(RosterEntry),
          mentors: z.array(TeamPerson.extend({ role: MentorRole }).strict()),
        })
        .strict(),
    ),
    /** Inactive team members, left out of the roster. */
    leftOut: z.array(RosterEntry),
    conflicts: z.array(AssignConflict),
    warnings: z.array(AssignWarning),
    /** False when a conflict or an empty roster stops it; warnings never do. */
    canAssign: z.boolean(),
  })
  .strict();
export type AssignPreview = z.infer<typeof AssignPreview>;

export const AssignResult = z.object({ competitions: z.array(CompetitionListItem) }).strict();
export type AssignResult = z.infer<typeof AssignResult>;

export const TransitionRequest = z
  .object({ to: EngagementStatus, note: z.string().trim().max(500).nullish(), version: Version })
  .strict();
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const CompetitionUpdateRequest = z
  .object({ notes: z.string().max(COMPETITION_NOTES_MAX).nullable(), version: Version })
  .strict();
export type CompetitionUpdateRequest = z.infer<typeof CompetitionUpdateRequest>;

export const AddParticipantRequest = z
  .object({ studentId: Uuid7, roleLabel: RoleLabel, version: Version })
  .strict();
export type AddParticipantRequest = z.infer<typeof AddParticipantRequest>;

export const CompetitionVersionRequest = z.object({ version: Version }).strict();
export type CompetitionVersionRequest = z.infer<typeof CompetitionVersionRequest>;

export const CompetitionAddMentorRequest = z.object({ userId: Uuid7, version: Version }).strict();
export type CompetitionAddMentorRequest = z.infer<typeof CompetitionAddMentorRequest>;

export const CompetitionTransferRequest = z
  .object({ toUserId: Uuid7, stepAway: z.boolean(), version: Version })
  .strict();
export type CompetitionTransferRequest = z.infer<typeof CompetitionTransferRequest>;
