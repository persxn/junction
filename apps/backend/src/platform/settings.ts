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
 */

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
}
