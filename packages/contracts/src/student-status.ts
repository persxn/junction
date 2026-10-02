import { z } from 'zod';

/** `students.status` (§6.2). An import never changes it (R93). */
export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ALUMNI'] as const;
export const StudentStatus = z.enum(STUDENT_STATUSES);
export type StudentStatus = z.infer<typeof StudentStatus>;

export const STUDENT_STATUS_LABELS: Readonly<Record<StudentStatus, string>> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ALUMNI: 'Alumni',
};
