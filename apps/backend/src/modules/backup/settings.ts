import { z } from 'zod';

import { define } from '../../platform/settings.js';

/** The backup module's settings (§14, rulings R42 and R43). */

/** `HH:mm` in the host machine's local time (§14 "Schedule and checks"). */
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** The age recipient backups are encrypted to — public, no secret (R42). */
export const BACKUP_PUBLIC_KEY = define('backup.publicKey', {
  schema: z.string(),
  default: '',
  description: 'The age public key every backup is encrypted to. Safe to show.',
});

/** The age identity, armored and encrypted to the backup passphrase (R42). */
export const BACKUP_PRIVATE_KEY_ENCRYPTED = define('backup.privateKeyEncrypted', {
  schema: z.string(),
  default: '',
  description:
    'The age private key, itself encrypted to the backup passphrase. Useless without that passphrase.',
});

/** Where encrypted backups are written; validated by R43 before it is stored. */
export const BACKUP_DESTINATION_DIR = define('backup.destinationDir', {
  schema: z.string(),
  default: '',
  description: 'Folder the encrypted backups are written to. Must be outside the data directory.',
});

/** §14: daily backup time in the host's local time; 13:00 is when a host is likely on. */
export const BACKUP_DAILY_TIME_LOCAL = define('backup.dailyTimeLocal', {
  schema: LocalTime,
  default: '13:00',
  description: 'Time of day the automatic backup runs, in this machine’s local time.',
});
