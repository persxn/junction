import { z } from 'zod';

import type { SourceRow } from '../../db/schema/index.js';
import {
  definitionOf,
  type SettingDefinition,
  type SettingsStore,
} from '../../platform/settings.js';
import type { SourceCredential } from '../../scraping/http/index.js';
import { CLIST_API_KEY, CLIST_API_USERNAME } from './settings.js';

/**
 * A source's credential: the *shape* lives in `sources.config_json.auth` (so a
 * wrong header can be corrected by a migration, not a release), the *values* in
 * two secret settings (§6.2 footnote). Nothing here logs a value.
 */

const AuthConfig = z
  .object({
    header: z.string().min(1),
    /** `{username}` and `{key}` are substituted, e.g. "ApiKey {username}:{key}". */
    valueTemplate: z.string().min(1),
    usernameSetting: z.string().min(1),
    keySetting: z.string().min(1),
    /** What a run records when the credential is not set, e.g. "CLIST API key not set (U4)". */
    missingDetail: z.string().min(1).optional(),
  })
  .strict();
export type AuthConfig = z.infer<typeof AuthConfig>;

/** `config_json.auth`, or `undefined` for a source that needs no credential. */
export function authConfigOf(source: SourceRow): AuthConfig | undefined {
  let raw: unknown;
  try {
    raw = (JSON.parse(source.configJson) as { auth?: unknown }).auth;
  } catch {
    return undefined;
  }
  const parsed = AuthConfig.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The two settings a source's credential lives in. Only a `secret` setting may
 * be named: a config that pointed at, say, `scraper.contactEmail` would put a
 * non-secret value into a request header, and more to the point it is a typo.
 */
function settingsOf(auth: AuthConfig): {
  username: SettingDefinition<string>;
  key: SettingDefinition<string>;
} {
  const username = definitionOf(auth.usernameSetting) as SettingDefinition<string>;
  const key = definitionOf(auth.keySetting) as SettingDefinition<string>;
  if (username.secret !== true || key.secret !== true) {
    throw new TypeError('A source credential must be stored in secret settings.');
  }
  return { username, key };
}

/** The header to send, or `undefined` when either half is not set (U4). */
export function resolveCredential(
  source: SourceRow,
  settings: SettingsStore,
): SourceCredential | undefined {
  const auth = authConfigOf(source);
  if (auth === undefined) {
    return undefined;
  }
  const { username, key } = settingsOf(auth);
  const user = settings.get(username).trim();
  const secret = settings.get(key).trim();
  if (user.length === 0 || secret.length === 0) {
    return undefined;
  }
  return {
    kind: 'API_KEY',
    header: auth.header,
    value: auth.valueTemplate.replace('{username}', user).replace('{key}', secret),
  };
}

export function credentialIsSet(source: SourceRow, settings: SettingsStore): boolean {
  return resolveCredential(source, settings) !== undefined;
}

/** Stores both halves; the caller audits the act, never the values. */
export function storeCredential(
  source: SourceRow,
  settings: SettingsStore,
  value: { readonly username: string; readonly apiKey: string },
  updatedBy: string,
): boolean {
  const auth = authConfigOf(source);
  if (auth === undefined) {
    return false;
  }
  const { username, key } = settingsOf(auth);
  settings.set(username, value.username.trim(), updatedBy);
  settings.set(key, value.apiKey.trim(), updatedBy);
  return true;
}

/**
 * `--dev` only: `COMPINTEL_CLIST_API_KEY` / `COMPINTEL_CLIST_API_USERNAME` may
 * seed the CLIST credential so a developer does not have to call the admin
 * route by hand. Never in a packaged build, and never over a stored value.
 */
export function seedDevCredentials(
  settings: SettingsStore,
  dev: boolean,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const key = env.COMPINTEL_CLIST_API_KEY?.trim() ?? '';
  const username = env.COMPINTEL_CLIST_API_USERNAME?.trim() ?? '';
  if (!dev || key.length === 0 || username.length === 0) {
    return false;
  }
  if (settings.get(CLIST_API_KEY).length > 0) {
    return false;
  }
  settings.set(CLIST_API_USERNAME, username);
  settings.set(CLIST_API_KEY, key);
  return true;
}
