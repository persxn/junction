import {
  STUDENT_PROGRAMS,
  STUDENT_STATUSES,
  TAG_RELATIONS,
  type StudentProgram,
  type StudentStatus,
  type TagRelation,
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
import { departments, organizations } from './organization.js';

/**
 * §6.2 "People" (rulings R91–R93, roadmap WP-17).
 *
 * Students belong to the organization, not to a department or a professor
 * (R91: every professor sees and edits every student). Two columns are added to
 * §6.2's list: `university_id_key`, the roll number upper-cased with spaces
 * removed, which is what R93 matches on and what the unique index holds; and
 * `erased_at`, set by R92's erasure, after which the row is an anonymous shell
 * that keeps team and competition history in shape.
 */

const inList = (column: string, values: readonly string[]): string =>
  `"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`;

export const students = sqliteTable(
  'students',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** The roll or enrolment number, as typed. */
    universityId: text('university_id').notNull(),
    /** R93: `universityId` upper-cased, spaces removed — what matches and what is unique. */
    universityIdKey: text('university_id_key').notNull(),
    fullName: text('full_name').notNull(),
    preferredName: text('preferred_name'),
    institutionalEmail: text('institutional_email'),
    /** Collected only while `students.phoneEnabled` is on (Q8). */
    phone: text('phone'),
    homeDepartmentId: text('home_department_id')
      .notNull()
      .references(() => departments.id),
    program: text('program').$type<StudentProgram>().notNull(),
    branch: text('branch'),
    graduationYear: integer('graduation_year'),
    isExternal: integer('is_external', { mode: 'boolean' }).notNull().default(false),
    externalInstitution: text('external_institution'),
    status: text('status').$type<StudentStatus>().notNull().default('ACTIVE'),
    /** Short, and never sensitive (§6.2). */
    notes: text('notes'),
    privacyNoticeAckAt: integer('privacy_notice_ack_at'),
    /** R92: set once, by an administrator's erasure. */
    erasedAt: integer('erased_at'),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('students_org_university_id_key_uq').on(
      table.organizationId,
      table.universityIdKey,
    ),
    index('students_full_name_idx').on(table.fullName),
    index('students_status_idx').on(table.status),
    index('students_program_idx').on(table.program),
    index('students_graduation_year_idx').on(table.graduationYear),
    check('students_program_check', sql.raw(inList('program', STUDENT_PROGRAMS))),
    check('students_status_check', sql.raw(inList('status', STUDENT_STATUSES))),
    check(
      'students_graduation_year_check',
      sql.raw(`"graduation_year" is null or "graduation_year" between 1950 and 2100`),
    ),
    check('students_notes_length_check', sql.raw(`"notes" is null or length("notes") <= 500`)),
    check('students_version_check', sql.raw(`"version" >= 1`)),
  ],
);
export type StudentRow = typeof students.$inferSelect;

/** Skills and interests (§6.2); proficiency 1–3 or null, "Not rated" (R91). */
export const studentTags = sqliteTable(
  'student_tags',
  {
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
    relation: text('relation').$type<TagRelation>().notNull(),
    proficiency: integer('proficiency'),
  },
  (table) => [
    primaryKey({ columns: [table.studentId, table.tagId, table.relation] }),
    index('student_tags_tag_id_idx').on(table.tagId),
    check('student_tags_relation_check', sql.raw(inList('relation', TAG_RELATIONS))),
    check(
      'student_tags_proficiency_check',
      sql.raw(`"proficiency" is null or "proficiency" between 1 and 3`),
    ),
  ],
);
export type StudentTagRow = typeof studentTags.$inferSelect;

/** History from before the app (§6.2); in-app outcomes come from competitions. */
export const studentAchievements = sqliteTable(
  'student_achievements',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    title: text('title').notNull(),
    eventName: text('event_name'),
    year: integer('year'),
    result: text('result'),
    url: text('url'),
    notes: text('notes'),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (table) => [index('student_achievements_student_id_idx').on(table.studentId)],
);
export type StudentAchievementRow = typeof studentAchievements.$inferSelect;

/**
 * A professor's "my students" (§6.2, R91). Ending sets `ended_at` and never
 * deletes; one *open* mentorship per (mentor, student), which the partial
 * unique index holds.
 */
export const mentorships = sqliteTable(
  'mentorships',
  {
    id: text('id').primaryKey(),
    mentorUserId: text('mentor_user_id')
      .notNull()
      .references(() => users.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id),
  },
  (table) => [
    uniqueIndex('mentorships_open_uq')
      .on(table.mentorUserId, table.studentId)
      .where(sql`${table.endedAt} is null`),
    index('mentorships_student_id_idx').on(table.studentId),
    index('mentorships_mentor_user_id_idx').on(table.mentorUserId),
  ],
);
export type MentorshipRow = typeof mentorships.$inferSelect;
