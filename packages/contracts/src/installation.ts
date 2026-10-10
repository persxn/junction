import { z } from 'zod';

/**
 * What kind of installation this is (ruling R130, owner decisions O-4…O-7).
 *
 * Chosen once, by the first-run wizard, and never changed by any route:
 *   - `DEPARTMENT` — a professor or department, exactly as before WP-34. Also the
 *     default, so a database from before the setting existed reads as one.
 *   - `STUDENT_INDIVIDUAL` — "Myself": one student's own PC, one profile.
 *   - `STUDENT_INSTITUTION` — "An institution": a club PC, several profiles, the
 *     first one leading.
 */
export const INSTALLATION_MODES = [
  'DEPARTMENT',
  'STUDENT_INDIVIDUAL',
  'STUDENT_INSTITUTION',
] as const;
export const InstallationMode = z.enum(INSTALLATION_MODES);
export type InstallationMode = z.infer<typeof InstallationMode>;

/** Both student modes: the guest exists, PROFESSOR may never be granted (R131). */
export function isStudentMode(mode: InstallationMode | null | undefined): boolean {
  return mode === 'STUDENT_INDIVIDUAL' || mode === 'STUDENT_INSTITUTION';
}

/** The guest's login identifier: reserved (RFC 2606 `.invalid`), never a sign-in (R132). */
export const GUEST_EMAIL = 'guest@junction.invalid';
export const GUEST_DISPLAY_NAME = 'Guest';
