import type {
  Cancellation,
  DatePrecision,
  DeadlineKind,
  EngagementStatus,
  EventType,
  MentorRole,
  ParticipantKind,
  RemovalReason,
  StudentStatus,
  Visibility,
} from '@compintel/contracts';

/** The row shapes the competitions repository returns (WP-19). */

export interface EventRecord {
  readonly id: string;
  readonly title: string;
  readonly eventType: EventType;
  readonly registrationDeadlineAt: number | null;
  readonly registrationDeadlinePrecision: DatePrecision;
  readonly startsAt: number | null;
  readonly datePrecision: DatePrecision;
  readonly endsAt: number | null;
  readonly timezone: string | null;
  readonly cancellation: Cancellation;
  readonly teamMin: number | null;
  readonly teamMax: number | null;
  readonly visibility: Visibility;
  readonly mergedIntoEventId: string | null;
}

export interface EngagementRecord {
  readonly id: string;
  readonly departmentId: string;
  readonly eventId: string;
  readonly kind: ParticipantKind;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly status: EngagementStatus;
  readonly statusChangedAt: number;
  readonly notes: string | null;
  readonly createdAt: number;
  readonly version: number;
}

export interface ParticipantRecord {
  readonly engagementId: string;
  readonly studentId: string;
  readonly fullName: string;
  readonly universityId: string;
  readonly studentStatus: StudentStatus;
  readonly erasedAt: number | null;
  readonly roleLabel: string | null;
  readonly addedAt: number;
  readonly removedAt: number | null;
  readonly removalReason: RemovalReason | null;
}

export interface CompetitionMentorRecord {
  readonly id: string;
  readonly engagementId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: MentorRole;
  readonly fromAt: number;
  readonly toAt: number | null;
}

export interface HistoryRecord {
  readonly id: string;
  readonly fromStatus: EngagementStatus | null;
  readonly toStatus: EngagementStatus;
  readonly changedBy: string | null;
  readonly changedAt: number;
  readonly note: string | null;
}

/** Someone already on an open roster for an event (A14). */
export interface ActiveParticipation {
  readonly studentId: string;
  readonly engagementId: string;
  readonly kind: ParticipantKind;
  readonly teamName: string | null;
  readonly studentName: string;
  readonly eventTitle: string;
}

export interface DeadlineRecord {
  readonly eventId: string;
  readonly kind: DeadlineKind;
  readonly at: number;
  readonly precision: DatePrecision;
}
