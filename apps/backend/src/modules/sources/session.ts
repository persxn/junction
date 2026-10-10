import type { SourceSessionState, SourceSessionStatus } from '@compintel/contracts';
import { z } from 'zod';

import type { SourceRow } from '../../db/schema/index.js';
import {
  definitionOf,
  type SettingDefinition,
  type SettingsStore,
} from '../../platform/settings.js';
import { DEFAULT_SIGNED_IN_BUDGET, type SourceCredential } from '../../scraping/http/index.js';
import { isSealed, seal, unseal, type SessionKey } from './seal.js';
import { conflict } from '../../platform/errors.js';

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
 *
 * Ruling R76 adds a fourth: **sealed at rest.** The stored value is AES-256-GCM
 * ciphertext under a key the shell holds outside the database (`seal.ts`), so a
 * copy of `app.db` or a backup restored elsewhere carries nothing usable. A
 * backend with no key — standalone, server mode, a machine where the shell could
 * not make one — cannot open a session, reports it `UNAVAILABLE` and reads the
 * source's public pages. That is a fifth state of the source, not an error.
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
    /**
     * R75's allowance for this source: how many signed-in requests one run may
     * make, and how far apart. Absent means R75's own numbers (5, 10 s); a
     * migration that widens them is the recorded decision R75 asks for.
     */
    signedIn: z
      .object({
        maxRequestsPerRun: z.int().min(0).max(50),
        minIntervalMs: z.int().min(1_000),
      })
      .strict()
      .optional(),
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

/**
 * Everything the session functions read and write: the settings table, and the
 * key that opens what is in it (R76).
 *
 * One parameter rather than two, because every caller has both or neither, and
 * because a call site that forgot the key would silently look like a backend
 * with none.
 */
export interface SessionVault {
  readonly settings: SettingsStore;
  readonly key: SessionKey;
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

/**
 * The state a stored session is in, from the three things that decide it: is
 * there one, was it refused, and can this machine open it (R76).
 */
function stateOfStored(
  raw: string,
  stored: string,
  opened: string | undefined,
): SourceSessionState {
  if (stored.length === 0) {
    return 'NONE';
  }
  if (raw === 'EXPIRED') {
    return 'EXPIRED';
  }
  return opened === undefined ? 'UNAVAILABLE' : 'ACTIVE';
}

/** The sealed cookie, opened, or `undefined` when this machine cannot. */
export function openSession(source: SourceRow, vault: SessionVault): string | undefined {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return undefined;
  }
  const stored = vault.settings.get(settingsOf(config).cookie).trim();
  if (stored.length === 0) {
    return undefined;
  }
  const opened = unseal(vault.key, stored);
  return opened === undefined || opened.length === 0 ? undefined : opened;
}

/** What `GET /admin/sources/:key/session` answers. Never the cookie itself. */
export function sessionStatus(source: SourceRow, vault: SessionVault): SourceSessionStatus {
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
  const stored = vault.settings.get(keys.cookie).trim();
  return {
    supported: true,
    isSet: stored.length > 0,
    state: stateOfStored(vault.settings.get(keys.state), stored, openSession(source, vault)),
    capturedAt: instant(vault.settings.get(keys.capturedAt)),
    lastVerifiedAt: instant(vault.settings.get(keys.verifiedAt)),
    loginUrl: config.loginUrl,
    hosts: [...config.hosts],
  };
}

/**
 * The header to send, or `undefined` when there is no usable session.
 *
 * An `EXPIRED` session is deliberately not sent. Re-sending a cookie the site
 * has already rejected is how a signed-out account turns into a run of 401s, and
 * R74 says the source falls back to its public pages instead. A session this
 * machine cannot open (R76) is the same answer for a different reason.
 */
export function resolveSessionCredential(
  source: SourceRow,
  vault: SessionVault,
): SourceCredential | undefined {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return undefined;
  }
  if (vault.settings.get(settingsOf(config).state) === 'EXPIRED') {
    return undefined;
  }
  const cookie = openSession(source, vault);
  if (cookie === undefined) {
    return undefined;
  }
  return {
    kind: 'SESSION',
    header: config.header,
    value: cookie,
    hosts: config.hosts,
    budget:
      config.signedIn === undefined
        ? DEFAULT_SIGNED_IN_BUDGET
        : {
            maxRequests: config.signedIn.maxRequestsPerRun,
            minIntervalMs: config.signedIn.minIntervalMs,
          },
  };
}

/** Whether a session is set at all, expired or not — what the UI shows. */
export function sessionIsSet(source: SourceRow, settings: SettingsStore): boolean {
  const config = sessionConfigOf(source);
  if (config === undefined) {
    return false;
  }
  return settings.get(settingsOf(config).cookie).trim().length > 0;
}

/**
 * Refuses to take a session on a machine that cannot seal one (R76).
 *
 * Storing it anyway would mean writing live account access to the database in
 * the clear, which is the exact thing R76 rules out — so this says so instead,
 * in words the professor can act on.
 */
export function assertCanSeal(vault: SessionVault): void {
  if (vault.key === undefined) {
    throw conflict(
      'This machine cannot store a session.',
      'A session is sealed under a key the desktop shell holds (R76), and this backend was started without one. Start Junction from its own shortcut and try again.',
    );
  }
}

/**
 * Seals the plaintext sessions an older build stored, once (R76).
 *
 * Runs at startup, after the migrations. It is idempotent by construction — a
 * value that is already sealed is skipped — and it does nothing at all without a
 * key, because overwriting the only copy of a session with something this
 * machine could not open afterwards would be worse than leaving it.
 *
 * Returns how many were sealed, which the caller logs as a count and never as a
 * value.
 */
export function sealStoredSessions(sources: readonly SourceRow[], vault: SessionVault): number {
  if (vault.key === undefined) {
    return 0;
  }
  let sealed = 0;
  for (const source of sources) {
    const config = sessionConfigOf(source);
    if (config === undefined) {
      continue;
    }
    const keys = settingsOf(config);
    const stored = vault.settings.get(keys.cookie).trim();
    if (stored.length === 0 || isSealed(stored)) {
      continue;
    }
    vault.settings.set(keys.cookie, seal(vault.key, stored), 'SYSTEM');
    sealed += 1;
  }
  return sealed;
}

/**
 * Stores the cookie, sealed, and marks it active. The caller audits the act,
 * never the value.
 *
 * `false` means it was not stored: the source may not hold a session, or this
 * machine has no key and storing it would mean writing a live session in the
 * clear (R76). The route turns that into a sentence the professor can act on.
 */
export function storeSession(
  source: SourceRow,
  vault: SessionVault,
  cookie: string,
  updatedBy: string,
  at: number,
): boolean {
  const config = sessionConfigOf(source);
  if (config === undefined || vault.key === undefined) {
    return false;
  }
  const { settings } = vault;
  const keys = settingsOf(config);
  settings.set(keys.cookie, seal(vault.key, cookie.trim()), updatedBy);
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

/**
 * …and the one it shows when the session is there but this machine cannot open
 * it (R76): a restored backup, a different Windows account, a key file that went
 * missing.
 */
export function unavailableDetail(source: SourceRow): string {
  return `Your ${source.name} session is stored but cannot be opened on this machine — sign in again. Until then ${source.name} is read from its public pages only.`;
}
