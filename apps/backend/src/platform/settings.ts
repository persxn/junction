import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { settings } from '../db/schema/index.js';
import type { DatabaseHandle } from './db.js';
import { nowMs, systemClock, type Clock } from './time.js';

/**
 * The typed setting registry (§6.2 `settings`: "typed registry in code").
 *
 * The table is one key and one JSON blob; the meaning lives in code. What
 * changed in pre-M1 is *where* in code: a setting is now declared by the module
 * that owns it, with `define()`, rather than in one central list that thirteen
 * work packages would take turns editing. WP-08b brings the geography and
 * event-type policies, WP-10 the dedup thresholds, WP-15b the ranking weights —
 * each in its own file, none of them touching this one.
 *
 * `define()` hands back a typed handle, and that handle is the only way to read
 * or write the setting. Two useful things follow. A typo is a compile error
 * rather than a silent default, exactly as it was before. And because a module
 * must import the handle to use the setting, the definition is guaranteed to
 * have been registered before anything reads it — there is no import-order
 * hazard of the kind a registry of bare strings would have.
 *
 * A setting that has never been written reads as its default, so a fresh install
 * works before the wizard has run; a stored value that no longer parses — an
 * older build wrote it, or someone edited the file — falls back to the default
 * with a warning rather than taking the backend down at startup.
 */

/** What a module says about the setting it owns. */
export interface SettingSpec<T> {
  readonly schema: z.ZodType<T>;
  readonly default: T;
  /** One sentence: what this changes, for the admin screen and the registry dump. */
  readonly description: string;
  /**
   * A credential (§6.2 footnote: source API keys are "never logged or
   * exported"). Its value is left out of {@link exportableSettings}, which every
   * export and diagnostics dump must go through, and its key is added to the log
   * redaction list.
   */
  readonly secret?: boolean;
}

/** A registered setting. Holding one of these is what lets you read or write it. */
export interface SettingDefinition<T> extends SettingSpec<T> {
  readonly key: string;
}

/** Dotted `area.name`, so the registry sorts into something readable. */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

const registry = new Map<string, SettingDefinition<unknown>>();

/**
 * Declares a setting. Called once, at module load, by the module that owns it.
 *
 * Defining the same key twice throws rather than letting the second definition
 * win: two modules disagreeing about a key's schema or default is the kind of
 * thing that surfaces as a mysterious value months later.
 */
export function define<T>(key: string, spec: SettingSpec<T>): SettingDefinition<T> {
  if (!KEY_PATTERN.test(key)) {
    throw new TypeError(`Setting key "${key}" is not a dotted name, e.g. "auth.autoLockMinutes".`);
  }
  if (registry.has(key)) {
    throw new TypeError(`Setting "${key}" is defined twice; a key has exactly one owner.`);
  }
  if (spec.description.trim().length === 0) {
    throw new TypeError(`Setting "${key}" needs a description; it is shown to an administrator.`);
  }
  const definition: SettingDefinition<T> = { key, ...spec };
  registry.set(key, definition);
  return definition;
}

/**
 * Every registered setting, sorted by key — the admin screen's list, and what
 * the tests walk. It only sees the modules that have been imported, which is why
 * `src/settings.ts` imports them all in one place.
 */
export function settingDefinitions(): readonly SettingDefinition<unknown>[] {
  return [...registry.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Keys whose values are credentials and never leave the database (§6.2). */
export function secretSettingKeys(): readonly string[] {
  return settingDefinitions()
    .filter((definition) => definition.secret === true)
    .map((definition) => definition.key);
}

/** Every registered key, sorted. */
export function settingKeys(): readonly string[] {
  return settingDefinitions().map((definition) => definition.key);
}

/**
 * The definition for a key given as a string — the wizard writing a batch, the
 * admin screen editing one by name. An unregistered key throws: a setting nobody
 * declared has no schema to validate against and no honest default to fall back
 * to, so answering at all would be a guess.
 */
export function definitionOf(key: string): SettingDefinition<unknown> {
  const definition = registry.get(key);
  if (definition === undefined) {
    throw new TypeError(`No setting is registered under "${key}".`);
  }
  return definition;
}

/**
 * The stored form of a value, validated first. Used by {@link SettingsStore.set}
 * and by the setup wizard, which writes its settings inside the one transaction
 * R40 requires and so cannot go through the store row by row.
 */
export function serialize<T>(definition: SettingDefinition<T>, value: T): string {
  return JSON.stringify(definition.schema.parse(value));
}

export interface SettingsStoreOptions {
  readonly clock?: Clock;
  /** Called when a stored value cannot be parsed; the default is used instead. */
  readonly onInvalid?: (key: string, reason: string) => void;
}

export class SettingsStore {
  readonly #db: DatabaseHandle;
  readonly #clock: Clock;
  readonly #onInvalid: (key: string, reason: string) => void;

  constructor(db: DatabaseHandle, options: SettingsStoreOptions = {}) {
    this.#db = db;
    this.#clock = options.clock ?? systemClock;
    this.#onInvalid = options.onInvalid ?? ((): void => undefined);
  }

  /** Milliseconds since the epoch, the shape every timestamp column wants. */
  get #nowMs(): number {
    return nowMs(this.#clock);
  }

  /** The stored value, or this setting's default when it is absent or unreadable. */
  get<T>(definition: SettingDefinition<T>): T {
    const row = this.#db.drizzle
      .select()
      .from(settings)
      .where(eq(settings.key, definition.key))
      .get();
    if (row === undefined) {
      return definition.default;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.valueJson);
    } catch {
      this.#onInvalid(definition.key, 'the stored value is not JSON');
      return definition.default;
    }
    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) {
      this.#onInvalid(
        definition.key,
        parsed.error.issues[0]?.message ?? 'the stored value is not valid',
      );
      return definition.default;
    }
    return parsed.data;
  }

  /** The value for a key named at runtime; throws if nothing declared it. */
  getByKey(key: string): unknown {
    return this.get(definitionOf(key));
  }

  /** Writes a value after validating it; an invalid one throws rather than lands. */
  set<T>(definition: SettingDefinition<T>, value: T, updatedBy?: string): void {
    const row = {
      key: definition.key,
      valueJson: serialize(definition, value),
      updatedAt: this.#nowMs,
      updatedBy: updatedBy ?? null,
    };
    this.#db.drizzle
      .insert(settings)
      .values(row)
      .onConflictDoUpdate({ target: settings.key, set: row })
      .run();
  }

  /**
   * Every setting's current value, **without the secret ones** — the only
   * sanctioned source for an export, a backup manifest or a diagnostics dump
   * (§6.2: source API keys are never exported). A secret is reported as whether
   * it is set, never as what it is.
   */
  exportableSettings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const definition of settingDefinitions()) {
      out[definition.key] =
        definition.secret === true
          ? { isSet: this.has(definition) && this.get(definition) !== definition.default }
          : this.get(definition);
    }
    return out;
  }

  /** True when the key has a row of its own, whatever it says. */
  has(definition: SettingDefinition<unknown>): boolean {
    return (
      this.#db.drizzle
        .select({ key: settings.key })
        .from(settings)
        .where(eq(settings.key, definition.key))
        .get() !== undefined
    );
  }
}
