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
