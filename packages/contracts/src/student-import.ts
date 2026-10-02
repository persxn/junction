import { z } from 'zod';

/**
 * Importing students from CSV or XLSX (§15, ruling R93, roadmap WP-17).
 *
 * Preview, then commit. The preview reads the file, maps its columns and
 * validates every row against the stored students; it is kept on the server
 * under a random id for 30 minutes and bound to the caller. The commit names
 * that id and applies only the rows with no errors, re-checked against the
 * database at that moment.
 */

/** R93's limits. The base64 text is a third larger; R78's 1 MB body cap still holds. */
export const STUDENT_IMPORT_MAX_FILE_BYTES = 700 * 1024;
export const STUDENT_IMPORT_MAX_ROWS = 5_000;
export const STUDENT_IMPORT_MAX_COLUMNS = 50;
export const STUDENT_IMPORT_PREVIEW_TTL_MS = 30 * 60_000;

/** The student fields a column can feed. */
export const STUDENT_IMPORT_FIELDS = [
  'universityId',
  'fullName',
  'preferredName',
  'institutionalEmail',
  'phone',
  'program',
  'branch',
  'homeDepartment',
  'graduationYear',
  'skills',
  'interests',
  'notes',
] as const;
export const StudentImportField = z.enum(STUDENT_IMPORT_FIELDS);
export type StudentImportField = z.infer<typeof StudentImportField>;

/** What the mapping step shows for each field. */
export const STUDENT_IMPORT_FIELD_LABELS: Readonly<Record<StudentImportField, string>> = {
  universityId: 'Roll number',
  fullName: 'Full name',
  preferredName: 'Preferred name',
  institutionalEmail: 'College e-mail',
  phone: 'Phone',
  program: 'Programme',
  branch: 'Branch',
  homeDepartment: 'Department',
  graduationYear: 'Graduation year',
  skills: 'Skills',
  interests: 'Interests',
  notes: 'Notes',
};

/** Rows that need these mapped cannot be imported at all. */
export const STUDENT_IMPORT_REQUIRED_FIELDS: readonly StudentImportField[] = [
  'universityId',
  'fullName',
  'program',
];

export const STUDENT_IMPORT_ACTIONS = ['CREATE', 'UPDATE', 'SKIP'] as const;
export const StudentImportAction = z.enum(STUDENT_IMPORT_ACTIONS);
export type StudentImportAction = z.infer<typeof StudentImportAction>;

export const STUDENT_IMPORT_ACTION_LABELS: Readonly<Record<StudentImportAction, string>> = {
  CREATE: 'New student',
  UPDATE: 'Update',
  SKIP: 'No change',
};

/** One column as read, and what it feeds (`null`: "Not imported"). */
export const StudentImportColumn = z
  .object({
    index: z.int().min(0),
    header: z.string(),
    field: StudentImportField.nullable(),
    /** True when the field came from an alias rather than from the professor. */
    guessed: z.boolean(),
  })
  .strict();
export type StudentImportColumn = z.infer<typeof StudentImportColumn>;

/** A professor's mapping: column index → field, or `null` to leave it out. */
export const StudentImportMapping = z
  .array(z.object({ index: z.int().min(0), field: StudentImportField.nullable() }).strict())
  .max(STUDENT_IMPORT_MAX_COLUMNS);
export type StudentImportMapping = z.infer<typeof StudentImportMapping>;

export const StudentImportFieldError = z
  .object({
    /** The field the problem is in, or `row` for the row as a whole. */
    field: z.union([StudentImportField, z.literal('row')]),
    message: z.string().min(1),
  })
  .strict();
export type StudentImportFieldError = z.infer<typeof StudentImportFieldError>;

export const StudentImportRow = z
  .object({
    /** 1-based, counting the header as row 1 — what a spreadsheet shows. */
    rowNumber: z.int().min(2),
    action: StudentImportAction,
    values: z.partialRecord(StudentImportField, z.string()),
    /** For an UPDATE: what would change, in words. */
    changes: z.array(
      z.object({ field: StudentImportField, from: z.string(), to: z.string() }).strict(),
    ),
    errors: z.array(StudentImportFieldError),
  })
  .strict();
export type StudentImportRow = z.infer<typeof StudentImportRow>;

export const StudentImportPreviewRequest = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    /** The file's bytes, base64. */
    base64: z
      .string()
      .min(1)
      .max(Math.ceil((STUDENT_IMPORT_MAX_FILE_BYTES * 4) / 3) + 4),
    mapping: StudentImportMapping.optional(),
  })
  .strict();
export type StudentImportPreviewRequest = z.infer<typeof StudentImportPreviewRequest>;

export const StudentImportPreview = z
  .object({
    previewId: z.string().min(16),
    fileName: z.string(),
    format: z.enum(['CSV', 'XLSX']),
    columns: z.array(StudentImportColumn),
    /** Headers of the columns nothing is taken from — "Not imported", never guessed. */
    unknownColumns: z.array(z.string()),
    /** Problems with the mapping itself (two columns on one field, a required field missing). */
    mappingErrors: z.array(StudentImportFieldError),
    counts: z
      .object({
        create: z.int().min(0),
        update: z.int().min(0),
        skip: z.int().min(0),
        error: z.int().min(0),
        total: z.int().min(0),
      })
      .strict(),
    rows: z.array(StudentImportRow),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type StudentImportPreview = z.infer<typeof StudentImportPreview>;

export const StudentImportCommitRequest = z
  .object({
    previewId: z.string().min(16).max(100),
    /** R91: the importer mentors the students it creates. */
    mentorMe: z.boolean(),
    /** Q8: the privacy notice was given to the students being created. */
    privacyNoticeShown: z.boolean(),
  })
  .strict();
export type StudentImportCommitRequest = z.infer<typeof StudentImportCommitRequest>;

export const StudentImportCommitResult = z
  .object({
    created: z.int().min(0),
    updated: z.int().min(0),
    skipped: z.int().min(0),
    /** Rows with errors in the preview — never applied. */
    failed: z.int().min(0),
    /** Rows that changed since the preview, reported and not applied (R93). */
    stale: z.array(z.object({ rowNumber: z.int(), reason: z.string() }).strict()),
  })
  .strict();
export type StudentImportCommitResult = z.infer<typeof StudentImportCommitResult>;
