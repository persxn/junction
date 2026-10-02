import {
  MENTOR_ROLES,
  TEAM_STATUSES,
  type MentorRole,
  type TeamStatus,
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

import { tags } from './categories.js';
import { users } from './identity.js';
import { departments } from './organization.js';
import { students } from './students.js';

/**
 * §6.2 "Teams" (rulings R94–R95, roadmap WP-18).
 *
 * Member and mentor rows are opened and closed, never deleted (R95), so the
 * "one open X" rules of §6.2 are partial unique indexes over the open rows.
 * `name_key` is the name trimmed and lower-cased: R95 compares names that way,
 * and only among ACTIVE teams, so an archived team frees its name.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    description: text('description'),
    status: text('status').$type<TeamStatus>().notNull().default('ACTIVE'),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('teams_active_name_uq')
      .on(table.departmentId, table.nameKey)
      .where(sql`"status" = 'ACTIVE'`),
    index('teams_status_idx').on(table.status),
    check('teams_status_check', sql.raw(inList('status', TEAM_STATUSES))),
    check('teams_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type TeamRow = typeof teams.$inferSelect;

export const teamMembers = sqliteTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    roleLabel: text('role_label'),
    isLead: integer('is_lead', { mode: 'boolean' }).notNull().default(false),
    joinedAt: integer('joined_at').notNull(),
    leftAt: integer('left_at'),
  },
  (table) => [
    uniqueIndex('team_members_open_uq')
      .on(table.teamId, table.studentId)
      .where(sql`"left_at" is null`),
    uniqueIndex('team_members_open_lead_uq')
      .on(table.teamId)
      .where(sql`"is_lead" = 1 and "left_at" is null`),
    index('team_members_student_id_idx').on(table.studentId),
    check(
      'team_members_role_label_check',
      sql.raw(`"role_label" is null or length("role_label") <= 40`),
    ),
  ],
);
export type TeamMemberRow = typeof teamMembers.$inferSelect;

export const teamMentors = sqliteTable(
  'team_mentors',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').$type<MentorRole>().notNull(),
    fromAt: integer('from_at').notNull(),
    toAt: integer('to_at'),
  },
  (table) => [
    uniqueIndex('team_mentors_open_primary_uq')
      .on(table.teamId)
      .where(sql`"role" = 'PRIMARY' and "to_at" is null`),
    uniqueIndex('team_mentors_open_uq')
      .on(table.teamId, table.userId)
      .where(sql`"to_at" is null`),
    index('team_mentors_user_id_idx').on(table.userId),
    check('team_mentors_role_check', sql.raw(inList('role', MENTOR_ROLES))),
  ],
);
export type TeamMentorRow = typeof teamMentors.$inferSelect;

/** R94: the skills a team wants covered; optional. */
export const teamSkillTargets = sqliteTable(
  'team_skill_targets',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.tagId] })],
);
