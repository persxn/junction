import {
  ENGAGEMENT_STATUSES,
  MENTOR_ROLES,
  PARTICIPANT_KINDS,
  REMOVAL_REASONS,
  type EngagementStatus,
  type MentorRole,
  type ParticipantKind,
  type RemovalReason,
} from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { events } from './events.js';
import { users } from './identity.js';
import { departments } from './organization.js';
import { students } from './students.js';
import { teams } from './teams.js';

/**
 * §6.2 "Competitions" (table `engagements`, UI label "Competition"; rulings
 * R96–R98, roadmap WP-19). `engagement_outcomes` is WP-21's.
 *
 * "Active" is "open" (R97): a participant while `removed_at` is null, a mentor
 * while `to_at` is null, a competition while it is not WITHDRAWN or
 * NOT_SELECTED — and each "one active X" rule is a partial unique index over
 * exactly those rows, so a raw insert that skips the service still fails.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const engagements = sqliteTable(
  'engagements',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    participantKind: text('participant_kind').$type<ParticipantKind>().notNull(),
    teamId: text('team_id').references(() => teams.id),
    status: text('status').$type<EngagementStatus>().notNull(),
    statusChangedAt: integer('status_changed_at').notNull(),
    internalNotes: text('internal_notes'),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // R97: one open competition per (event, team); a withdrawn or unselected
    // one no longer counts, so the team may try again.
    uniqueIndex('engagements_event_team_open_uq')
      .on(table.eventId, table.teamId)
      .where(sql`"team_id" is not null and "status" not in ('WITHDRAWN', 'NOT_SELECTED')`),
    index('engagements_status_idx').on(table.status),
    index('engagements_team_id_idx').on(table.teamId),
    check('engagements_status_check', sql.raw(inList('status', ENGAGEMENT_STATUSES))),
    check('engagements_kind_check', sql.raw(inList('participant_kind', PARTICIPANT_KINDS))),
    check(
      'engagements_team_kind_check',
      sql.raw(
        `("participant_kind" = 'TEAM' and "team_id" is not null) or ("participant_kind" = 'INDIVIDUAL' and "team_id" is null)`,
      ),
    ),
    check('engagements_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type EngagementRow = typeof engagements.$inferSelect;

export const engagementParticipants = sqliteTable(
  'engagement_participants',
  {
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    /** Denormalized from the competition, so A14 can be an index. */
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    roleLabel: text('role_label'),
    addedAt: integer('added_at').notNull(),
    removedAt: integer('removed_at'),
    removalReason: text('removal_reason').$type<RemovalReason>(),
  },
  (table) => [
    primaryKey({ columns: [table.engagementId, table.studentId] }),
    // A14: one active competition per student per event.
    uniqueIndex('engagement_participants_event_student_active_uq')
      .on(table.eventId, table.studentId)
      .where(sql`"removed_at" is null`),
    index('engagement_participants_student_id_idx').on(table.studentId),
    check(
      'engagement_participants_reason_check',
      sql.raw(
        `("removed_at" is null and "removal_reason" is null) or ("removed_at" is not null and ${inList('removal_reason', REMOVAL_REASONS)})`,
      ),
    ),
    check(
      'engagement_participants_role_label_check',
      sql.raw(`"role_label" is null or length("role_label") <= 40`),
    ),
  ],
);
export type EngagementParticipantRow = typeof engagementParticipants.$inferSelect;

export const engagementMentors = sqliteTable(
  'engagement_mentors',
  {
    id: text('id').primaryKey(),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').$type<MentorRole>().notNull(),
    fromAt: integer('from_at').notNull(),
    toAt: integer('to_at'),
  },
  (table) => [
    uniqueIndex('engagement_mentors_open_primary_uq')
      .on(table.engagementId)
      .where(sql`"role" = 'PRIMARY' and "to_at" is null`),
    uniqueIndex('engagement_mentors_open_uq')
      .on(table.engagementId, table.userId)
      .where(sql`"to_at" is null`),
    index('engagement_mentors_user_id_idx').on(table.userId),
    check('engagement_mentors_role_check', sql.raw(inList('role', MENTOR_ROLES))),
  ],
);
export type EngagementMentorRow = typeof engagementMentors.$inferSelect;

export const engagementStatusHistory = sqliteTable(
  'engagement_status_history',
  {
    id: text('id').primaryKey(),
    engagementId: text('engagement_id')
      .notNull()
      .references(() => engagements.id),
    fromStatus: text('from_status').$type<EngagementStatus>(),
    toStatus: text('to_status').$type<EngagementStatus>().notNull(),
    changedBy: text('changed_by').references(() => users.id),
    changedAt: integer('changed_at').notNull(),
    note: text('note'),
  },
  (table) => [
    index('engagement_status_history_engagement_idx').on(table.engagementId, table.changedAt),
    check('engagement_status_history_to_check', sql.raw(inList('to_status', ENGAGEMENT_STATUSES))),
    check(
      'engagement_status_history_from_check',
      sql.raw(`"from_status" is null or ${inList('from_status', ENGAGEMENT_STATUSES)}`),
    ),
  ],
);
export type EngagementStatusHistoryRow = typeof engagementStatusHistory.$inferSelect;
