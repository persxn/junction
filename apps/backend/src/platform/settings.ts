import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { settings } from '../db/schema/index.js';
import type { DatabaseHandle } from './db.js';

/**
 * The typed setting registry (§6.2 `settings`: "typed registry in code").
 *
 * The table is one key and one JSON blob; the meaning lives here. A setting that
 * has never been written reads as its default, so a fresh install works before
 * WP-07b's wizard has run, and a value that no longer parses — an older build
 * wrote it, or someone edited the file — falls back to the default with a
 * warning rather than taking the backend down at startup.
 *
 * Every key is declared here and nowhere else: no module reads a setting by a
 * string it made up, so "what is configurable" is answerable by reading one
 * file, and a typo is a type error.
 */

/** `HH:mm` in the host machine's local time (§14 "Schedule and checks"). */
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** §7.4's geography policy, as the JSON the spec prints. */
const GeographyPolicy = z.object({
  inPerson: z.object({ allowCountries: z.array(z.string().length(2)) }),
  online: z.object({ allow: z.enum(['ALL', 'ALLOWED_COUNTRIES']) }),
  hybrid: z.object({
    evaluate: z.enum(['PHYSICAL_LOCATION', 'ONLINE']),
    ifOutsideAllowed: z.enum(['SHOW_AS_ONLINE', 'HIDE']),
  }),
  unknownLocation: z.enum(['SHOW_FLAGGED', 'HIDE']),
});

const definitions = {
  /**
   * Minutes of inactivity before the session's idle expiry lapses (§10.5,
   * ruling R33). The server enforces it; the UI's lock screen is cosmetic.
   */
  'auth.autoLockMinutes': {
    schema: z
      .int()
      .min(1)
      .max(24 * 60),
    default: 15,
  },

  /**
   * Argon2id hash of the one-time admin recovery code (ruling R41). The code
   * itself is shown once at setup and never stored; an empty string means no
   * code has been issued.
   */
  'auth.recoveryCodeHash': { schema: z.string(), default: '' },

  /**
   * §7.2: every scraper request identifies itself with this address, and ruling
   * A10 forbids scraping until the wizard has set it. Empty means not set.
   */
  'scraper.contactEmail': { schema: z.string(), default: '' },

  /** The age recipient backups are encrypted to — public, no secret (R42). */
  'backup.publicKey': { schema: z.string(), default: '' },

  /** The age identity, armored and encrypted to the backup passphrase (R42). */
  'backup.privateKeyEncrypted': { schema: z.string(), default: '' },

  /** Where encrypted backups are written; validated by R43 before it is stored. */
  'backup.destinationDir': { schema: z.string(), default: '' },

  /** §14: daily backup time in the host's local time; 13:00 is when a host is likely on. */
  'backup.dailyTimeLocal': { schema: LocalTime, default: '13:00' },

  /** §7.4, the one configurable module. The wizard writes the default; WP-08b edits it. */
  'geography.policy': {
    schema: GeographyPolicy,
    default: {
      inPerson: { allowCountries: ['IN'] },
      online: { allow: 'ALL' },
      hybrid: { evaluate: 'PHYSICAL_LOCATION', ifOutsideAllowed: 'SHOW_AS_ONLINE' },
      unknownLocation: 'SHOW_FLAGGED',
    },
  },

  /** How far "nearby" reaches in Discover, measured from the primary campus (§7.4). */
  'geography.nearbyRadiusKm': { schema: z.int().min(1).max(5_000), default: 250 },
} as const;

export type SettingKey = keyof typeof definitions;
export type SettingValue<K extends SettingKey> = z.infer<(typeof definitions)[K]['schema']>;

/** Every key the registry knows, for the admin screen and the tests. */
export const SETTING_KEYS = Object.keys(definitions) as readonly SettingKey[];

export function defaultSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return definitions[key].default as SettingValue<K>;
}

export interface SettingsStoreOptions {
  readonly now?: () => number;
  /** Called when a stored value cannot be parsed; the default is used instead. */
  readonly onInvalid?: (key: SettingKey, reason: string) => void;
}

export class SettingsStore {
  readonly #db: DatabaseHandle;
  readonly #now: () => number;
  readonly #onInvalid: (key: SettingKey, reason: string) => void;

  constructor(db: DatabaseHandle, options: SettingsStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
    this.#onInvalid = options.onInvalid ?? ((): void => undefined);
  }

  /** The stored value, or this key's default when it is absent or unreadable. */
  get<K extends SettingKey>(key: K): SettingValue<K> {
    const row = this.#db.drizzle.select().from(settings).where(eq(settings.key, key)).get();
    if (row === undefined) {
      return defaultSetting(key);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.valueJson);
    } catch {
      this.#onInvalid(key, 'the stored value is not JSON');
      return defaultSetting(key);
    }
    const parsed = definitions[key].schema.safeParse(raw);
    if (!parsed.success) {
      this.#onInvalid(key, parsed.error.issues[0]?.message ?? 'the stored value is not valid');
      return defaultSetting(key);
    }
    return parsed.data as SettingValue<K>;
  }

  /** Writes a value after validating it; an invalid one throws rather than lands. */
  set<K extends SettingKey>(key: K, value: SettingValue<K>, updatedBy?: string): void {
    const parsed = definitions[key].schema.parse(value);
    const row = {
      key,
      valueJson: JSON.stringify(parsed),
      updatedAt: this.#now(),
      updatedBy: updatedBy ?? null,
    };
    this.#db.drizzle
      .insert(settings)
      .values(row)
      .onConflictDoUpdate({ target: settings.key, set: row })
      .run();
  }

  /** True when the key has a row of its own, whatever it says. */
  has(key: SettingKey): boolean {
    return (
      this.#db.drizzle
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.key, key))
        .get() !== undefined
    );
  }
}
