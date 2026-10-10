import type {
  StudentCreateInput,
  StudentDetail,
  StudentProgram,
  StudentSettings,
  StudentUpdateRequest,
} from '@compintel/contracts';

/**
 * The student form's state and its translation to requests — pure, so the
 * rules (what is required, what a field may look like, what is sent when a
 * setting is off) are tested without rendering anything.
 */

export interface StudentFormState {
  readonly universityId: string;
  readonly fullName: string;
  readonly preferredName: string;
  readonly institutionalEmail: string;
  readonly phone: string;
  readonly homeDepartmentId: string;
  readonly program: StudentProgram;
  readonly branch: string;
  readonly graduationYear: string;
  readonly isExternal: boolean;
  readonly externalInstitution: string;
  readonly notes: string;
  readonly privacyNoticeShown: boolean;
  readonly mentorMe: boolean;
  /** R135 "This is me" — offered when creating, on a student install. */
  readonly isMe: boolean;
}

/** WP-34: what the install changes about the form (R135). */
export interface StudentFormRules {
  /** A student install: no roll number needed. */
  readonly rollNumberOptional?: boolean;
}

export type StudentFormErrors = Partial<Record<keyof StudentFormState, string>>;

export function emptyForm(homeDepartmentId: string): StudentFormState {
  return {
    universityId: '',
    fullName: '',
    preferredName: '',
    institutionalEmail: '',
    phone: '',
    homeDepartmentId,
    program: 'BTECH',
    branch: '',
    graduationYear: '',
    isExternal: false,
    externalInstitution: '',
    notes: '',
    privacyNoticeShown: false,
    mentorMe: true,
    isMe: false,
  };
}

export function formFromStudent(student: StudentDetail): StudentFormState {
  return {
    universityId: student.universityId ?? '',
    fullName: student.fullName,
    preferredName: student.preferredName ?? '',
    institutionalEmail: student.institutionalEmail ?? '',
    phone: student.phone ?? '',
    homeDepartmentId: student.homeDepartmentId,
    program: student.program,
    branch: student.branch ?? '',
    graduationYear: student.graduationYear === null ? '' : String(student.graduationYear),
    isExternal: student.isExternal,
    externalInstitution: student.externalInstitution ?? '',
    notes: student.notes ?? '',
    // Already given once: the box shows ticked and is not asked again.
    privacyNoticeShown: student.privacyNoticeAckAt !== null,
    mentorMe: false,
    isMe: false,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateForm(
  form: StudentFormState,
  settings: StudentSettings,
  rules: StudentFormRules = {},
): StudentFormErrors {
  const errors: StudentFormErrors = {};
  if (form.universityId.trim() === '') {
    if (rules.rollNumberOptional !== true) errors.universityId = 'Enter the roll number.';
  } else if (form.universityId.trim().length > 40)
    errors.universityId = 'A roll number has at most 40 characters.';
  if (form.fullName.trim().length < 2) errors.fullName = 'Enter the student’s full name.';
  if (form.institutionalEmail.trim() !== '' && !EMAIL.test(form.institutionalEmail.trim())) {
    errors.institutionalEmail = 'This does not look like an e-mail address.';
  }
  const year = form.graduationYear.trim();
  if (year !== '' && !/^\d{4}$/.test(year)) errors.graduationYear = 'A year looks like 2027.';
  else if (year !== '' && (Number(year) < 1950 || Number(year) > 2100)) {
    errors.graduationYear = 'Use a year between 1950 and 2100.';
  }
  if (
    settings.phoneEnabled &&
    form.phone.trim() !== '' &&
    !/^[+\d][\d\s()-]{5,29}$/.test(form.phone.trim())
  ) {
    errors.phone = 'Use digits, spaces and an optional leading +.';
  }
  if (form.notes.length > 500) errors.notes = 'Notes have at most 500 characters.';
  return errors;
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The fields both requests share; settings that are off send nothing for their fields. */
function fields(form: StudentFormState, settings: StudentSettings) {
  return {
    // Empty only reaches the server on a student install, where it means "none" (R135).
    universityId: form.universityId.trim(),
    fullName: form.fullName.trim(),
    preferredName: orNull(form.preferredName),
    institutionalEmail: orNull(form.institutionalEmail),
    ...(settings.phoneEnabled ? { phone: orNull(form.phone) } : {}),
    homeDepartmentId: form.homeDepartmentId,
    program: form.program,
    branch: orNull(form.branch),
    graduationYear: form.graduationYear.trim() === '' ? null : Number(form.graduationYear),
    ...(settings.allowExternal
      ? {
          isExternal: form.isExternal,
          externalInstitution: form.isExternal ? orNull(form.externalInstitution) : null,
        }
      : {}),
    notes: orNull(form.notes),
    ...(form.privacyNoticeShown ? { privacyNoticeShown: true } : {}),
  };
}

export function toCreateRequest(
  form: StudentFormState,
  settings: StudentSettings,
): StudentCreateInput {
  const { universityId, ...rest } = fields(form, settings);
  return {
    ...rest,
    ...(universityId === '' ? {} : { universityId }),
    mentorMe: form.mentorMe,
    ...(form.isMe ? { isMe: true } : {}),
  };
}

export function toUpdateRequest(
  form: StudentFormState,
  settings: StudentSettings,
  version: number,
): StudentUpdateRequest {
  return { ...fields(form, settings), version };
}
