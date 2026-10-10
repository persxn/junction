import {
  CampusInput,
  PASSPHRASE_MIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  type SetupRequest,
} from '@compintel/contracts';

/**
 * The wizard's model: what it collects, what counts as valid, and which step is
 * next (rulings R39–R44).
 *
 * All of it is pure. The components render this and nothing else, so "can the
 * user move on?" is answerable in a unit test rather than by driving nine
 * screens — and the rules cannot drift from the screens that show them.
 */

export const WIZARD_STEPS = [
  'welcome',
  'organization',
  'campus',
  'administrator',
  'contact',
  'folders',
  'passphrase',
  'recovery',
  'done',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** What the left rail lists. `welcome` and `done` are not numbered stages. */
export const NUMBERED_STEPS = WIZARD_STEPS.filter(
  (step) => step !== 'welcome' && step !== 'done',
) as readonly WizardStep[];

export const STEP_TITLES: Readonly<Record<WizardStep, string>> = {
  welcome: 'Welcome to Junction',
  organization: 'Your institution',
  campus: 'Where you are',
  administrator: 'Your administrator account',
  contact: 'Contact address',
  folders: 'Folders',
  passphrase: 'Backup passphrase',
  recovery: 'Save your recovery material',
  done: 'You are ready',
};

/** Every value the wizard holds. Strings throughout: these come from inputs. */
export interface WizardValues {
  organizationName: string;
  organizationShortName: string;
  departmentName: string;
  departmentCode: string;
  campusName: string;
  campusLat: string;
  campusLon: string;
  adminEmail: string;
  adminDisplayName: string;
  adminPassword: string;
  adminPasswordConfirm: string;
  scraperContactEmail: string;
  backupDir: string;
  backupPassphrase: string;
  backupPassphraseConfirm: string;
}

export type WizardField = keyof WizardValues;

export const EMPTY_VALUES: WizardValues = {
  organizationName: '',
  organizationShortName: '',
  departmentName: '',
  departmentCode: '',
  campusName: '',
  campusLat: '',
  campusLon: '',
  adminEmail: '',
  adminDisplayName: '',
  adminPassword: '',
  adminPasswordConfirm: '',
  scraperContactEmail: '',
  backupDir: '',
  backupPassphrase: '',
  backupPassphraseConfirm: '',
};

export type FieldErrors = Partial<Record<WizardField, string>>;

/** Deliberately loose: the server owns the real rule, this only catches typos. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function coordinate(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * What is wrong with this step, if anything. An empty object means the user may
 * move on; the keys are field names so each message lands under its own input.
 */
export function validateStep(step: WizardStep, values: WizardValues): FieldErrors {
  const errors: FieldErrors = {};

  switch (step) {
    case 'organization': {
      if (values.organizationName.trim().length < 2) {
        errors.organizationName = 'Enter the name of your college or university.';
      }
      if (values.departmentName.trim().length < 2) {
        errors.departmentName = 'Enter the department that will run Junction.';
      }
      break;
    }

    case 'campus': {
      if (values.campusName.trim().length < 2) {
        errors.campusName = 'Give this campus a name, such as "Main Campus".';
      }
      const lat = coordinate(values.campusLat);
      const lon = coordinate(values.campusLon);
      if (lat === undefined) {
        errors.campusLat = 'Enter a latitude in decimal degrees, e.g. 10.7594.';
      } else if (!CampusInput.shape.lat.safeParse(lat).success) {
        errors.campusLat = 'Latitude runs from -90 to 90.';
      }
      if (lon === undefined) {
        errors.campusLon = 'Enter a longitude in decimal degrees, e.g. 78.8149.';
      } else if (!CampusInput.shape.lon.safeParse(lon).success) {
        errors.campusLon = 'Longitude runs from -180 to 180.';
      }
      break;
    }

    case 'administrator': {
      if (!looksLikeEmail(values.adminEmail)) {
        errors.adminEmail = 'Enter the e-mail address you will sign in with.';
      }
      if (values.adminDisplayName.trim().length < 2) {
        errors.adminDisplayName = 'Enter the name other people will see.';
      }
      if (values.adminPassword.length < PASSWORD_MIN_LENGTH) {
        errors.adminPassword = `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`;
      }
      if (values.adminPasswordConfirm !== values.adminPassword) {
        errors.adminPasswordConfirm = 'The two passwords are not the same.';
      }
      break;
    }

    case 'contact': {
      if (!looksLikeEmail(values.scraperContactEmail)) {
        errors.scraperContactEmail = 'Enter an address event sites can reach you at.';
      }
      break;
    }

    case 'folders': {
      if (values.backupDir.trim() === '') {
        errors.backupDir = 'Choose a folder for encrypted backups.';
      }
      break;
    }

    case 'passphrase': {
      if (values.backupPassphrase.length < PASSPHRASE_MIN_LENGTH) {
        errors.backupPassphrase = `Use at least ${String(PASSPHRASE_MIN_LENGTH)} characters.`;
      } else if (values.backupPassphrase === values.adminPassword) {
        // Ruling R42: one unlocks this machine, the other unlocks backups that
        // leave it, so they must not be the same secret.
        errors.backupPassphrase = 'Use something different from your Junction password.';
      }
      if (values.backupPassphraseConfirm !== values.backupPassphrase) {
        errors.backupPassphraseConfirm = 'The two passphrases are not the same.';
      }
      break;
    }

    case 'welcome':
    case 'recovery':
    case 'done':
      break;
  }

  return errors;
}

/**
 * The same errors without this field's message. A plain `{ ...errors, [field]:
 * undefined }` is a different type under `exactOptionalPropertyTypes`, and the
 * key would still be there.
 */
export function clearError(errors: FieldErrors, field: WizardField): FieldErrors {
  const { [field]: _cleared, ...rest } = errors;
  return rest;
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/** The step after this one, or `undefined` on the last. */
export function nextStep(step: WizardStep): WizardStep | undefined {
  return WIZARD_STEPS[stepIndex(step) + 1];
}

/**
 * The step before this one. There is no way back from `recovery`: by then the
 * installation has been written and the wizard has nothing left to change.
 */
export function previousStep(step: WizardStep): WizardStep | undefined {
  if (step === 'recovery' || step === 'done') {
    return undefined;
  }
  return WIZARD_STEPS[stepIndex(step) - 1];
}

/** Everything the user typed, in the shape `POST /setup/complete` expects. */
export function toSetupRequest(values: WizardValues): SetupRequest {
  const short = values.organizationShortName.trim();
  const code = values.departmentCode.trim();
  return {
    organization: {
      name: values.organizationName.trim(),
      ...(short === '' ? {} : { shortName: short }),
    },
    department: {
      name: values.departmentName.trim(),
      ...(code === '' ? {} : { code }),
    },
    campus: {
      name: values.campusName.trim(),
      lat: Number(values.campusLat.trim()),
      lon: Number(values.campusLon.trim()),
    },
    admin: {
      email: values.adminEmail.trim(),
      displayName: values.adminDisplayName.trim(),
      password: values.adminPassword,
    },
    scraperContactEmail: values.scraperContactEmail.trim(),
    backupDir: values.backupDir,
    backupPassphrase: values.backupPassphrase,
  };
}
