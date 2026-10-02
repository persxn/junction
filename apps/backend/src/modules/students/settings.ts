import { z } from 'zod';

import { define } from '../../platform/settings.js';

/**
 * The two student settings (Q6, Q8, roadmap WP-17). Both default to off: phone
 * numbers are not collected until an administrator decides the department needs
 * them, and students from other colleges stay in the model but out of the forms
 * until the department works with them.
 */

/** Q8: the phone field exists only while this is on. */
export const STUDENTS_PHONE_ENABLED = define('students.phoneEnabled', {
  schema: z.boolean(),
  default: false,
  description: 'Whether student records collect a phone number (Q8). Off by default.',
});

/** Q6: students from other colleges can be created only while this is on. */
export const STUDENTS_ALLOW_EXTERNAL = define('students.allowExternal', {
  schema: z.boolean(),
  default: false,
  description: 'Whether students from other institutions can be added (Q6). Off by default.',
});
