import type { SourceSessionState, SourceSessionStatus } from '@compintel/contracts';
import { z } from 'zod';

import type { SourceRow } from '../../db/schema/index.js';
import {
  definitionOf,
  type SettingDefinition,
  type SettingsStore,
} from '../../platform/settings.js';
import type { SourceCredential } from '../../scraping/http/index.js';

/**
 * The professor's own signed-in session for a source (owner ruling R74 / D-34,
 * WP-14).
 *
 * It is stored the way WP-11 stores an API key and for the same reasons: the
 * *shape* is in `sources.config_json.session`, so a changed cookie name is a
 * migration rather than a release, and the *value* is in a `secret` setting, so
 * the log redaction list covers it and `exportableSettings()` — the only thing
 * an export or a diagnostics dump may read — reports it as set or not set.
 *
 * Three rules are enforced here rather than trusted:
 *
 * - **Its own hosts only.** The credential carries the source's `session.hosts`,
 *   and the client attaches the header to those hosts and to nothing else — not
 *   another host, not robots.txt, not `api.devfolio.co`.
 * - **Read-only.** Nothing here can produce anything but a request header on a
 *   GET; the adapters have no other verb.
 * - **Expired is a state, not a failure.** A 401, a 403 or a login redirect
 *   while a session was set marks it `EXPIRED`, the cookie stops being sent, and
 *   the source falls back to its public pages until a new one is given.
 */

const SessionConfig = z
  .object({
    /** Always `Cookie` today; named in config so a change is a migration. */
    header: z.string().min(1),
    cookieSetting: z.string().min(1),
    capturedAtSetting: z.string().min(1),
    stateSetting: z.string().min(1),
    verifiedAtSetting: z.string().min(1),
    /** The source's own login page — all the sign-in window may load. */
    loginUrl: z.url(),
    /** Host patterns the cookie may be sent to, and the window may navigate to. */
    hosts: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type SessionConfig = z.infer<typeof SessionConfig>;

/** `config_json.session`, or `undefined` for a source that may not hold one. */
export function sessionConfigOf(source: SourceRow): SessionConfig | undefined {
  let raw: unknown;
  try {
    raw = (JSON.parse(source.configJson) as { session?: unknown }).session;
  } catch {
    return undefined;
  }
  const parsed = SessionConfig.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

interface SessionSettings {
  readonly cookie: SettingDefinition<string>;
  readonly capturedAt: SettingDefinition<string>;
  readonly state: SettingDefinition<string>;
  readonly verifiedAt: SettingDefinition<string>;
}

/**
 * The four settings a session lives in. The cookie and the capture time must be
 * declared `secret`: a cookie in a non-secret setting would be exported with the
 * rest of them, and this is the check that makes that a startup error rather
 * than a discovery.
 */
function settingsOf(config: SessionConfig): SessionSettings {
  const cookie = definitionOf(config.cookieSetting) as SettingDefinition<string>;
  const capturedAt = definitionOf(config.capturedAtSetting) as SettingDefinition<string>;
  const state = definitionOf(config.stateSetting) as SettingDefinition<string>;
  const verifiedAt = definitionOf(config.verifiedAtSetting) as SettingDefinition<string>;
  if (cookie.secret !== true || capturedAt.secret !== true) {
    throw new TypeError('A source session must be stored in secret settings.');
  }
  return { cookie, capturedAt, state, verifiedAt };
}

function instant(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stateOf(raw: string, hasCookie: boolean): SourceSessionState {
  if (!hasCookie) {
    return 'NONE';
  }
  return raw === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
}

/** What `GET /admin/sources/:key/session` answers. Never the cookie itself. */
export function sessionStatus(source: SourceRow, settings: SettingsStore): SourceSessionStatus {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return {
      supported: false,
      isSet: false,
      state: 'NONE',
      capturedAt: null,
      lastVerifiedAt: null,
      hosts: [],
    };
  }
  const keys = settingsOf(config);
  const cookie = settings.get(keys.cookie).trim();
  return {
    supported: true,
    isSet: cookie.length > 0,
    state: stateOf(settings.get(keys.state), cookie.length > 0),
    capturedAt: instant(settings.get(keys.capturedAt)),
    lastVerifiedAt: instant(settings.get(keys.verifiedAt)),
    loginUrl: config.loginUrl,
    hosts: [...config.hosts],
  };
}

/**
 * The header to send, or `undefined` when there is no usable session.
 *
 * An `EXPIRED` session is deliberately not sent. Re-sending a cookie the site
 * has already rejected is how a signed-out account turns into a run of 401s, and
 * R74 says the source falls back to its public pages instead.
 */
export function resolveSessionCredential(
  source: SourceRow,
  settings: SettingsStore,
): SourceCredential | undefined {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return undefined;
  }
  const keys = settingsOf(config);
  const cookie = settings.get(keys.cookie).trim();
  if (cookie.length === 0 || settings.get(keys.state) === 'EXPIRED') {
    return undefined;
  }
  return { header: config.header, value: cookie, hosts: config.hosts };
}

/** Whether a session is set at all, expired or not — what the UI shows. */
export function sessionIsSet(source: SourceRow, settings: SettingsStore): boolean {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return false;
  }
  return settings.get(settingsOf(config).cookie).trim().length > 0;
}

/** Stores the cookie and marks it active. The caller audits the act, never the value. */
export function storeSession(
  source: SourceRow,
  settings: SettingsStore,
  cookie: string,
  updatedBy: string,
  at: number,
): boolean {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return false;
  }
  const keys = settingsOf(config);
  settings.set(keys.cookie, cookie.trim(), updatedBy);
  settings.set(keys.capturedAt, String(at), updatedBy);
  settings.set(keys.state, 'ACTIVE', updatedBy);
  settings.set(keys.verifiedAt, '', updatedBy);
  return true;
}

/** Signs the app out: the cookie is emptied and every marker with it. */
export function clearSession(
  source: SourceRow,
  settings: SettingsStore,
  updatedBy: string,
): boolean {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return false;
  }
  const keys = settingsOf(config);
  settings.set(keys.cookie, '', updatedBy);
  settings.set(keys.capturedAt, '', updatedBy);
  settings.set(keys.state, '', updatedBy);
  settings.set(keys.verifiedAt, '', updatedBy);
  return true;
}

/** The site rejected the session: it stops being sent and Source status says so. */
export function markSessionExpired(
  source: SourceRow,
  settings: SettingsStore,
  at: number,
): boolean {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return false;
  }
  const keys = settingsOf(config);
  if (settings.get(keys.cookie).trim().length === 0) {
    return false;
  }
  settings.set(keys.state, 'EXPIRED', 'SYSTEM');
  settings.set(keys.verifiedAt, String(at), 'SYSTEM');
  return true;
}

/** A run used the session and was not refused. */
export function markSessionVerified(source: SourceRow, settings: SettingsStore, at: number): void {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return;
  }
  const keys = settingsOf(config);
  if (settings.get(keys.cookie).trim().length > 0) {
    settings.set(keys.verifiedAt, String(at), 'SYSTEM');
  }
}

/** The sentence Source status shows while a session is expired (§7.7's voice). */
export function expiredDetail(source: SourceRow): string {
  return `Your ${source.name} session expired — sign in again. Until then ${source.name} is read from its public pages only.`;
}
