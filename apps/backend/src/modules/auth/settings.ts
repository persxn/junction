import { z } from 'zod';

import { define } from '../../platform/settings.js';

/** The auth module's settings (§10.5, rulings R33 and R41). */

/**
 * Minutes of inactivity before the session's idle expiry lapses (§10.5, ruling
 * R33). The server enforces it; the UI's lock screen is cosmetic.
 */
export const AUTO_LOCK_MINUTES = define('auth.autoLockMinutes', {
  schema: z
    .int()
    .min(1)
    .max(24 * 60),
  default: 15,
  description: 'Minutes of inactivity before the app locks and the session has to be unlocked.',
});

/**
 * Argon2id hash of the one-time admin recovery code (ruling R41). The code
 * itself is shown once at setup and never stored; an empty string means no code
 * has been issued. WP-30 owns spending it (R45).
 */
export const RECOVERY_CODE_HASH = define('auth.recoveryCodeHash', {
  schema: z.string(),
  default: '',
  description: 'Hash of the one-time administrator recovery code. Never the code itself.',
});
