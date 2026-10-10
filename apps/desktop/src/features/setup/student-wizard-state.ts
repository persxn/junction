import type { StudentSetupRequest } from '@compintel/contracts';

/**
 * The student half of the first-run wizard (WP-34, rulings R130, R133, R134).
 *
 * Pure, like `wizard-state.ts`: which steps a student sees, what each needs, and
 * the request they add up to. There is no account, password, folder or
 * passphrase anywhere in it — a student reaches the app in four screens
 * (welcome, who, where, contact) with nothing to remember.
 */

export type Representing = 'MYSELF' | 'INSTITUTION';

export const STUDENT_STEPS: Readonly<Record<Representing, readonly StudentStep[]>> = {
  MYSELF: ['about', 'contact'],
  INSTITUTION: ['institution', 'campus', 'contact'],
};
export type StudentStep = 'about' | 'institution' | 'campus' | 'contact';

export const STUDENT_STEP_TITLES: Readonly<Record<StudentStep, string>> = {
  about: 'About you',
  institution: 'Your institution',
  campus: 'Where the campus is',
  contact: 'Contact address',
};

export const STUDENT_STEP_DESCRIPTIONS: Readonly<Record<StudentStep, string>> = {
  about: 'So “nearby” means near you. Your name is optional.',
  institution: 'The college you represent, and your club, chapter or team.',
  campus: 'Distances in Discover are measured from here.',
  contact: 'How event sites can reach a person.',
};

/** A place from the picker, or typed coordinates; strings because they come from inputs. */
export interface PlaceValue {
  readonly label: string;
  readonly lat: string;
  readonly lon: string;
}

export interface StudentValues {
  readonly displayName: string;
  readonly place: PlaceValue;
  readonly organizationName: string;
  readonly groupName: string;
  readonly contact: string;
}

export const EMPTY_STUDENT_VALUES: StudentValues = {
  displayName: '',
  place: { label: '', lat: '', lon: '' },
  organizationName: '',
  groupName: '',
  contact: '',
};

export type StudentField = 'displayName' | 'place' | 'organizationName' | 'groupName' | 'contact';
export type StudentErrors = Partial<Record<StudentField, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function coordinate(value: string, limit: number): number | undefined {
  const parsed = Number(value.trim());
  return value.trim() === '' || !Number.isFinite(parsed) || Math.abs(parsed) > limit
    ? undefined
    : parsed;
}

function placeProblem(place: PlaceValue, what: string): string | undefined {
  if (place.label.trim().length < 2) return `Choose ${what} from the list, or type its name.`;
  if (coordinate(place.lat, 90) === undefined || coordinate(place.lon, 180) === undefined) {
    return 'Pick a suggestion, or enter the latitude and longitude.';
  }
  return undefined;
}

export function validateStudentStep(step: StudentStep, values: StudentValues): StudentErrors {
  switch (step) {
    case 'about': {
      const place = placeProblem(values.place, 'where you are');
      const name = values.displayName.trim();
      return {
        ...(place === undefined ? {} : { place }),
        ...(name.length === 1
          ? { displayName: 'Use at least two letters, or leave it empty.' }
          : {}),
      };
    }
    case 'institution':
      return {
        ...(values.organizationName.trim().length < 2
          ? { organizationName: 'Enter the institution’s name.' }
          : {}),
        ...(values.groupName.trim().length < 2
          ? { groupName: 'Enter your club, chapter or team.' }
          : {}),
      };
    case 'campus': {
      const place = placeProblem(values.place, 'the campus');
      return place === undefined ? {} : { place };
    }
    case 'contact':
      return EMAIL.test(values.contact.trim()) ? {} : { contact: 'Enter an e-mail address.' };
  }
}

export function hasErrors(errors: StudentErrors): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

/** The step after this one, or `undefined` when this one submits. */
export function nextStudentStep(kind: Representing, step: StudentStep): StudentStep | undefined {
  const steps = STUDENT_STEPS[kind];
  return steps[steps.indexOf(step) + 1];
}

export function previousStudentStep(
  kind: Representing,
  step: StudentStep,
): StudentStep | undefined {
  const steps = STUDENT_STEPS[kind];
  return steps[steps.indexOf(step) - 1];
}

/** The request, once every step has validated. */
export function toStudentRequest(kind: Representing, values: StudentValues): StudentSetupRequest {
  const place = {
    label: values.place.label.trim(),
    lat: Number(values.place.lat),
    lon: Number(values.place.lon),
  };
  const scraperContactEmail = values.contact.trim();
  if (kind === 'MYSELF') {
    const displayName = values.displayName.trim();
    return {
      mode: 'STUDENT_INDIVIDUAL',
      ...(displayName === '' ? {} : { displayName }),
      home: place,
      scraperContactEmail,
    };
  }
  return {
    mode: 'STUDENT_INSTITUTION',
    organization: { name: values.organizationName.trim() },
    group: { name: values.groupName.trim() },
    campus: { name: place.label, lat: place.lat, lon: place.lon },
    scraperContactEmail,
  };
}
