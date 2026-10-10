import {
  GUEST_DISPLAY_NAME,
  GUEST_EMAIL,
  type RoleKey,
  type StudentSetupRequest,
} from '@compintel/contracts';

import { serialize } from '../../platform/settings.js';
import { AUTO_LOCK_MINUTES } from '../auth/settings.js';
import { normalizeEmail } from '../auth/repository.js';
import { INSTALLATION_MODE } from '../installation/settings.js';
import { SCRAPER_CONTACT_EMAIL } from '../org/settings.js';
import type { SetupWrite } from './repository.js';

/**
 * The student branches of first-run setup (rulings R130, R132–R134).
 *
 * Pure: it turns the request into the same `SetupWrite` the department branch
 * produces, so R40's one transaction, the R39 gate and the audit row are shared.
 * What differs is who the first account is — the built-in guest, with no
 * password — and what is *not* written: no administrator password, no recovery
 * code and no backup key (backups stay "not set up" until WP-28's screen).
 */

/**
 * Not a PHC string, so `verifyPassword` answers false without throwing and no
 * password ever signs the guest in (R132). The guest signs in with
 * `POST /auth/guest` instead.
 */
export const GUEST_PASSWORD_HASH = '!guest-has-no-password';

/** Whether a stored hash is the guest's sentinel rather than a real password. */
export function isGuestHash(passwordHash: string): boolean {
  return passwordHash === GUEST_PASSWORD_HASH;
}

/**
 * Until a profile exists the guest holds STUDENT + ADMINISTRATOR, on both
 * modes: the machine is theirs (Myself), and the R39 gate needs an ACTIVE
 * administrator (an institution, until R134 hands it to the first profile).
 */
export const FIRST_GUEST_ROLES: readonly RoleKey[] = ['STUDENT', 'ADMINISTRATOR'];

export interface StudentSetupPlan {
  readonly write: SetupWrite;
  /** For the audit row and the summary. */
  readonly label: string;
}

export function studentSetupPlan(request: StudentSetupRequest): StudentSetupPlan {
  const settings: [string, string][] = [
    [INSTALLATION_MODE.key, serialize(INSTALLATION_MODE, request.mode)],
    [
      SCRAPER_CONTACT_EMAIL.key,
      serialize(SCRAPER_CONTACT_EMAIL, normalizeEmail(request.scraperContactEmail)),
    ],
    [AUTO_LOCK_MINUTES.key, serialize(AUTO_LOCK_MINUTES, AUTO_LOCK_MINUTES.default)],
  ];

  if (request.mode === 'STUDENT_INDIVIDUAL') {
    const name = request.displayName?.trim() ?? '';
    const displayName = name.length >= 2 ? name : GUEST_DISPLAY_NAME;
    return {
      label: 'Personal',
      write: {
        organization: { name: 'Personal' },
        department: { name: 'Personal' },
        campus: { name: request.home.label, lat: request.home.lat, lon: request.home.lon },
        admin: {
          email: GUEST_EMAIL,
          displayName,
          passwordHash: GUEST_PASSWORD_HASH,
          isGuest: true,
        },
        roles: FIRST_GUEST_ROLES,
        settings,
      },
    };
  }

  return {
    label: request.organization.name,
    write: {
      organization: request.organization,
      department: request.group,
      campus: request.campus,
      admin: {
        email: GUEST_EMAIL,
        displayName: GUEST_DISPLAY_NAME,
        passwordHash: GUEST_PASSWORD_HASH,
        isGuest: true,
      },
      roles: FIRST_GUEST_ROLES,
      settings,
    },
  };
}
