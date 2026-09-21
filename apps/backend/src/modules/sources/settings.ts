import { z } from 'zod';

import { define } from '../../platform/settings.js';

/**
 * Source credentials (§6.2 footnote, WP-11).
 *
 * CLIST's v4 API needs an account name and an API key, which a person creates
 * (U4). Both are `secret`: the log redaction list covers them and
 * `SettingsStore.exportableSettings()` — the only thing an export or a
 * diagnostics dump may read — reports them as set or not set, never as values.
 * They are written through the admin credential route and nowhere else.
 */

export const CLIST_API_USERNAME = define('sources.clist.apiUsername', {
  schema: z.string(),
  default: '',
  description: 'The CLIST account name the API key belongs to (U4). Never logged or exported.',
  secret: true,
});

export const CLIST_API_KEY = define('sources.clist.apiKey', {
  schema: z.string(),
  default: '',
  description: 'The CLIST v4 API key (U4). Never logged or exported.',
  secret: true,
});

/**
 * The professor's own session for a source (R74/D-34, WP-14), one set per
 * source that may hold one.
 *
 * The cookie and the moment it was captured are `secret`: the cookie is a
 * credential for a person's account, and when it was taken is a fact about that
 * person. The state and the last-verified time are not — they are what Source
 * status shows an administrator, and "expired" has to be readable in a
 * diagnostics dump for the screen to be worth anything.
 *
 * `config_json.session` names these keys, so a source that may not hold a
 * session simply has no block and no settings; nothing else distinguishes them.
 */
function defineSessionSettings(key: string, name: string): void {
  define(`sources.${key}.sessionCookie`, {
    schema: z.string(),
    default: '',
    description: `The ${name} session cookie the professor gave us (R74). Read-only use, their own account, never logged or exported.`,
    secret: true,
  });
  define(`sources.${key}.sessionCapturedAt`, {
    schema: z.string(),
    default: '',
    description: `When the ${name} session was captured, in epoch milliseconds.`,
    secret: true,
  });
  define(`sources.${key}.sessionState`, {
    schema: z.string(),
    default: '',
    description: `ACTIVE or EXPIRED for the ${name} session; an expired one is a source state, not a failure.`,
  });
  define(`sources.${key}.sessionVerifiedAt`, {
    schema: z.string(),
    default: '',
    description: `The last run that used the ${name} session and was not refused, in epoch milliseconds.`,
  });
}

defineSessionSettings('devfolio', 'Devfolio');
defineSessionSettings('unstop', 'Unstop');
