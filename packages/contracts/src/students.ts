import { z } from 'zod';

import { Uuid7 } from './ids.js';
import { StudentStatus } from './student-status.js';
import { StudentTeam } from './teams.js';

/**
 * Students, their skills and interests, mentorships and achievements (§6.2
 * "People", rulings R91–R93, roadmap WP-17).
 *
 * Every enum here is three things at once, as elsewhere in this package: the
 * TEXT + CHECK in the migration, the zod shape the API validates, and the union
 * the UI switches on. The label maps are the only words the UI may show for
 * them — a raw enum value on screen is a fault the UI sweep looks for.
 */

/** `students.program` (§6.2). */
export const STUDENT_PROGRAMS = [
  'BTECH',
  'MTECH',
  'BSC',
  'MSC',
  'BCA',
  'MCA',
  'PHD',
  'OTHER',
] as const;
export const StudentProgram = z.enum(STUDENT_PROGRAMS);
export type StudentProgram = z.infer<typeof StudentProgram>;

export const PROGRAM_LABELS: Readonly<Record<StudentProgram, string>> = {
  BTECH: 'B.Tech',
  MTECH: 'M.Tech',
  BSC: 'B.Sc',
  MSC: 'M.Sc',
  BCA: 'BCA',
  MCA: 'MCA',
  PHD: 'PhD',
  OTHER: 'Other',
};

// `StudentStatus` lives in its own module so `teams.ts` can use it without an
// import cycle (StudentDetail lists the student's teams).
export { STUDENT_STATUSES, STUDENT_STATUS_LABELS, StudentStatus } from './student-status.js';

/** `student_tags.relation` (§6.2). */
export const TAG_RELATIONS = ['SKILL', 'INTEREST'] as const;
export const TagRelation = z.enum(TAG_RELATIONS);
export type TagRelation = z.infer<typeof TagRelation>;

export const TAG_RELATION_LABELS: Readonly<Record<TagRelation, string>> = {
  SKILL: 'Skill',
  INTEREST: 'Interest',
};

/** R91: 1 Beginner · 2 Intermediate · 3 Advanced; null is "Not rated". */
export const Proficiency = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Proficiency = z.infer<typeof Proficiency>;

export const PROFICIENCY_LABELS: Readonly<Record<Proficiency, string>> = {
  1: 'Beginner',
  2: 'Intermediate',
  3: 'Advanced',
};
export const NOT_RATED_LABEL = 'Not rated';

/** The words for a proficiency, including "Not rated". */
export function proficiencyLabel(value: Proficiency | null): string {
  return value === null ? NOT_RATED_LABEL : PROFICIENCY_LABELS[value];
}

/** R91/R92: what an erased student's name reads. */
export const ERASED_STUDENT_NAME = 'Erased student';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

/** `YYYY` within a plausible range for a cohort. */
export const GraduationYear = z.int().min(1950).max(2100);

/** One skill or interest on a student. */
export const StudentTag = z
  .object({
    tagId: Uuid7,
    name: z.string().min(1),
    relation: TagRelation,
    proficiency: Proficiency.nullable(),
  })
  .strict();
export type StudentTag = z.infer<typeof StudentTag>;

/** One mentorship, open or ended (R91: ending sets `endedAt`, never deletes). */
export const StudentMentor = z
  .object({
    mentorshipId: Uuid7,
    userId: Uuid7,
    displayName: z.string().min(1),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    note: z.string().nullable(),
  })
  .strict();
export type StudentMentor = z.infer<typeof StudentMentor>;

/** History from before the app (§6.2 `student_achievements`). */
export const StudentAchievement = z
  .object({
    id: Uuid7,
    title: z.string().min(1),
    eventName: z.string().nullable(),
    year: z.int().nullable(),
    result: z.string().nullable(),
    url: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .strict();
export type StudentAchievement = z.infer<typeof StudentAchievement>;

export const StudentAchievementInput = z
  .object({
    title: text(200),
    eventName: optionalText(200),
    year: GraduationYear.nullish(),
    result: optionalText(200),
    url: z.url().max(2048).nullish(),
    notes: optionalText(1000),
  })
  .strict();
export type StudentAchievementInput = z.infer<typeof StudentAchievementInput>;

/** One row of the Students list. */
export const StudentListItem = z
  .object({
    id: Uuid7,
    universityId: z.string().min(1),
    fullName: z.string().min(1),
    preferredName: z.string().nullable(),
    institutionalEmail: z.string().nullable(),
    program: StudentProgram,
    branch: z.string().nullable(),
    graduationYear: z.int().nullable(),
    status: StudentStatus,
    isExternal: z.boolean(),
    homeDepartmentName: z.string().nullable(),
    /** Skill names first, then interests; for the row's chips. */
    tags: z.array(z.object({ name: z.string(), relation: TagRelation }).strict()),
    /** Active mentors' display names. */
    mentorNames: z.array(z.string()),
    /** The caller is an active mentor (R91's "My students"). */
    isMine: z.boolean(),
    erased: z.boolean(),
    version: z.int().min(1),
  })
  .strict();
export type StudentListItem = z.infer<typeof StudentListItem>;

/** Everything the Student page shows. */
export const StudentDetail = z
  .object({
    id: Uuid7,
    universityId: z.string().min(1),
    fullName: z.string().min(1),
    preferredName: z.string().nullable(),
    institutionalEmail: z.string().nullable(),
    /** Absent from the answer altogether while `students.phoneEnabled` is off. */
    phone: z.string().nullable().optional(),
    homeDepartmentId: Uuid7,
    homeDepartmentName: z.string().nullable(),
    program: StudentProgram,
    branch: z.string().nullable(),
    graduationYear: z.int().nullable(),
    isExternal: z.boolean(),
    externalInstitution: z.string().nullable(),
    status: StudentStatus,
    notes: z.string().nullable(),
    privacyNoticeAckAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    erasedAt: z.iso.datetime().nullable(),
    tags: z.array(StudentTag),
    mentors: z.array(StudentMentor),
    achievements: z.array(StudentAchievement),
    /** Open memberships first, then past ones (WP-18). */
    teams: z.array(StudentTeam),
    /** What the caller may do here — cosmetic, the server decides again (§10.1). */
    canDeactivate: z.boolean(),
    canErase: z.boolean(),
    version: z.int().min(1),
  })
  .strict();
export type StudentDetail = z.infer<typeof StudentDetail>;

/** The form's fields, shared by create and edit. */
const StudentFields = {
  universityId: text(40),
  fullName: text(200),
  preferredName: optionalText(100),
  institutionalEmail: z.email().max(254).nullish(),
  phone: optionalText(30),
  homeDepartmentId: Uuid7.optional(),
  program: StudentProgram,
  branch: optionalText(100),
  graduationYear: GraduationYear.nullish(),
  isExternal: z.boolean().optional(),
  externalInstitution: optionalText(200),
  notes: optionalText(500),
  /** The privacy notice was shown and acknowledged: stamps `privacy_notice_ack_at` (Q8). */
  privacyNoticeShown: z.boolean().optional(),
};

export const StudentCreateRequest = z
  .object({
    ...StudentFields,
    /** R91: the creator mentors the student unless this is cleared. */
    mentorMe: z.boolean().default(true),
  })
  .strict();
export type StudentCreateRequest = z.infer<typeof StudentCreateRequest>;
export type StudentCreateInput = z.input<typeof StudentCreateRequest>;

export const StudentUpdateRequest = z
  .object({
    universityId: StudentFields.universityId.optional(),
    fullName: StudentFields.fullName.optional(),
    preferredName: StudentFields.preferredName,
    institutionalEmail: StudentFields.institutionalEmail,
    phone: StudentFields.phone,
    homeDepartmentId: StudentFields.homeDepartmentId,
    program: StudentProgram.optional(),
    branch: StudentFields.branch,
    graduationYear: StudentFields.graduationYear,
    isExternal: StudentFields.isExternal,
    externalInstitution: StudentFields.externalInstitution,
    notes: StudentFields.notes,
    privacyNoticeShown: StudentFields.privacyNoticeShown,
    version: z.int().min(1),
  })
  .strict();
export type StudentUpdateRequest = z.infer<typeof StudentUpdateRequest>;

/** `PUT /students/:id/tags` — the whole set (WP-16b's pattern). */
export const StudentTagsRequest = z
  .object({
    tags: z
      .array(
        z
          .object({ name: text(60), relation: TagRelation, proficiency: Proficiency.nullable() })
          .strict(),
      )
      .max(100),
    version: z.int().min(1),
  })
  .strict();
export type StudentTagsRequest = z.infer<typeof StudentTagsRequest>;

export const StartMentorshipRequest = z
  .object({
    /** Absent: the caller. Only an administrator may name someone else (R91). */
    mentorUserId: Uuid7.optional(),
    note: optionalText(200),
  })
  .strict();
export type StartMentorshipRequest = z.infer<typeof StartMentorshipRequest>;

/** `POST /admin/students/:id/erase` — the roll number, typed again (R92). */
export const EraseStudentRequest = z.object({ universityId: text(40) }).strict();
export type EraseStudentRequest = z.infer<typeof EraseStudentRequest>;

export const StudentVersionRequest = z.object({ version: z.int().min(1) }).strict();
export type StudentVersionRequest = z.infer<typeof StudentVersionRequest>;

/** Comma-separated list in a query string → array. */
const listParam = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : value,
    z.array(item).max(20),
  );

export const STUDENT_LIST_LIMIT_DEFAULT = 50;

/** `GET /students` — step 6's filters, a cursor, 50 a page. */
export const StudentListQuery = z
  .object({
    text: z.string().trim().max(100).optional(),
    programs: listParam(StudentProgram).optional(),
    branches: listParam(z.string().min(1).max(100)).optional(),
    graduationYears: listParam(z.coerce.number().pipe(GraduationYear)).optional(),
    statuses: listParam(StudentStatus).optional(),
    tag: z.string().trim().min(1).max(60).optional(),
    mine: z
      .preprocess((value) => value === true || value === 'true' || value === '1', z.boolean())
      .optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(STUDENT_LIST_LIMIT_DEFAULT),
  })
  .strict();
export type StudentListQuery = z.infer<typeof StudentListQuery>;
export type StudentListQueryInput = z.input<typeof StudentListQuery>;

export const StudentListResponse = z
  .object({
    items: z.array(StudentListItem),
    nextCursor: z.string().nullable(),
    total: z.int().min(0),
    /** Values the filter chips can offer. */
    facets: z.object({ branches: z.array(z.string()), graduationYears: z.array(z.int()) }).strict(),
  })
  .strict();
export type StudentListResponse = z.infer<typeof StudentListResponse>;

/** `GET/PUT /admin/settings/students`. */
export const StudentSettings = z
  .object({ phoneEnabled: z.boolean(), allowExternal: z.boolean() })
  .strict();
export type StudentSettings = z.infer<typeof StudentSettings>;

/** What the form needs to know before it renders (both flags are cosmetic there). */
export const StudentFormOptions = z
  .object({
    settings: StudentSettings,
    departments: z.array(
      z
        .object({
          id: Uuid7,
          name: z.string(),
          code: z.string().nullable(),
          isManaging: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type StudentFormOptions = z.infer<typeof StudentFormOptions>;

/** `GET /tags?kind=&text=` — the typeahead. */
export const TAG_SUGGESTION_KINDS = ['SKILL', 'INTEREST'] as const;
export const TagSuggestionQuery = z
  .object({
    kind: z.enum(TAG_SUGGESTION_KINDS).optional(),
    text: z.string().trim().max(60).default(''),
  })
  .strict();
export type TagSuggestionQuery = z.infer<typeof TagSuggestionQuery>;

export const TagSuggestions = z
  .object({ tags: z.array(z.object({ id: Uuid7, name: z.string() }).strict()) })
  .strict();
export type TagSuggestions = z.infer<typeof TagSuggestions>;
