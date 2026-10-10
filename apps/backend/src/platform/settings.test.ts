import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AUTO_LOCK_MINUTES } from '../modules/auth/settings.js';
import { BACKUP_DAILY_TIME_LOCAL, BACKUP_PUBLIC_KEY } from '../modules/backup/settings.js';
import { GEOGRAPHY_POLICY } from '../modules/geo/settings.js';
// The barrel, so the registry assertions below see every module's definitions
// and not only the ones the imports above happen to pull in.
import '../settings.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import {
  define,
  definitionOf,
  serialize,
  settingDefinitions,
  settingKeys,
  SettingsStore,
} from './settings.js';
import { fixedClock, type Clock } from './time.js';

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(clock: Clock = fixedClock('2023-11-14T22:13:20.000Z')): {
  store: SettingsStore;
  invalid: ReturnType<typeof vi.fn>;
  database: MigratedDatabase;
} {
  database = openMigratedDatabase(undefined, 'settings');
  const invalid = vi.fn();
  return {
    store: new SettingsStore(database.db, { clock, onInvalid: invalid }),
    invalid,
    database,
  };
}

describe('the typed setting registry (§6.2)', () => {
  it('reads a default for a key that has never been written', () => {
    const { store } = open();
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(15);
    expect(AUTO_LOCK_MINUTES.default).toBe(15);
  });

  it('round-trips a value', () => {
    const { store } = open();
    store.set(AUTO_LOCK_MINUTES, 30, 'user-1');
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(30);
  });

  it('overwrites rather than duplicating', () => {
    const { store, database: h } = open();
    store.set(AUTO_LOCK_MINUTES, 20);
    store.set(AUTO_LOCK_MINUTES, 25);
    const rows = h.db.raw.prepare('SELECT count(*) as n FROM settings').get() as { n: number };
    expect(rows.n).toBe(1);
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(25);
  });

  it('records who changed it and when', () => {
    const { store, database: h } = open(fixedClock('2023-11-14T22:13:20.000Z'));
    store.set(AUTO_LOCK_MINUTES, 30, 'user-7');
    const row = h.db.raw
      .prepare('SELECT * FROM settings WHERE key = ?')
      .get(AUTO_LOCK_MINUTES.key) as {
      updated_by: string;
      updated_at: number;
      value_json: string;
    };
    expect(row.updated_by).toBe('user-7');
    expect(row.updated_at).toBe(1_700_000_000_000);
    expect(row.value_json).toBe('30');
  });

  it('refuses to store a value the schema rejects', () => {
    const { store } = open();
    expect(() => {
      store.set(AUTO_LOCK_MINUTES, 0);
    }).toThrow();
    expect(() => {
      store.set(AUTO_LOCK_MINUTES, 10_000);
    }).toThrow();
    // Nothing landed, so the default still applies.
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(15);
  });

  it('falls back to the default when a stored value does not parse', () => {
    const { store, invalid, database: h } = open();
    h.db.raw
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?,?,?)')
      .run(AUTO_LOCK_MINUTES.key, 'not json', 1);
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(15);
    expect(invalid).toHaveBeenCalledWith(AUTO_LOCK_MINUTES.key, 'the stored value is not JSON');
  });

  it('falls back to the default when a stored value is the wrong shape', () => {
    const { store, invalid, database: h } = open();
    h.db.raw
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?,?,?)')
      .run(AUTO_LOCK_MINUTES.key, '"fifteen"', 1);
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(15);
    expect(invalid).toHaveBeenCalledTimes(1);
  });
});

describe('module-owned definitions', () => {
  it('defines every key exactly once', () => {
    const keys = settingKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('refuses a second definition of the same key', () => {
    expect(() =>
      define(AUTO_LOCK_MINUTES.key, { schema: z.int(), default: 1, description: 'A duplicate.' }),
    ).toThrow(/defined twice/);
  });

  it('gives every key a schema and a description', () => {
    for (const definition of settingDefinitions()) {
      expect(definition.schema, definition.key).toBeDefined();
      expect(definition.description.trim().length, definition.key).toBeGreaterThan(0);
      // The default must satisfy the schema, or a fresh install starts invalid.
      expect(() => definition.schema.parse(definition.default), definition.key).not.toThrow();
    }
  });

  it('refuses a definition with no description', () => {
    expect(() =>
      define('test.noDescription', { schema: z.int(), default: 1, description: '  ' }),
    ).toThrow(/needs a description/);
  });

  it('refuses a key that is not a dotted name', () => {
    expect(() => define('nodots', { schema: z.int(), default: 1, description: 'x' })).toThrow(
      /dotted name/,
    );
    expect(() => define('Bad.Key', { schema: z.int(), default: 1, description: 'x' })).toThrow(
      /dotted name/,
    );
  });

  it('throws when an unregistered key is read', () => {
    const { store } = open();
    expect(() => definitionOf('nobody.definedThis')).toThrow(/No setting is registered/);
    expect(() => store.getByKey('nobody.definedThis')).toThrow(/No setting is registered/);
  });

  it('resolves a registered key given as a string', () => {
    const { store } = open();
    store.set(AUTO_LOCK_MINUTES, 42);
    expect(store.getByKey(AUTO_LOCK_MINUTES.key)).toBe(42);
  });

  /**
   * Every key WP-07b shipped, still registered and still defaulting to what it
   * defaulted to then — a professor who upgrades must not find their auto-lock
   * or their backup folder quietly reset. Asserted literally, so moving a
   * definition to another module cannot change either by accident.
   */
  it("keeps every WP-07b key, with WP-07b's value", () => {
    expect(settingKeys()).toStrictEqual([
      // WP-33's, declared by modules/appearance: one value per user in each (R67, R68).
      'appearance.effects',
      'appearance.flavourDark',
      'appearance.flavourLight',
      'appearance.rgbPreset',
      'auth.autoLockMinutes',
      'auth.recoveryCodeHash',
      'backup.dailyTimeLocal',
      'backup.destinationDir',
      'backup.privateKeyEncrypted',
      'backup.publicKey',
      // WP-10's, declared by modules/events (R65).
      'dedup.autoMergeThreshold',
      'dedup.candidateThreshold',
      'dedup.weights',
      // WP-08b's, declared by modules/geo — the geography pair moved there from
      // modules/org without changing key or default, which is the point of the
      // handle-based registry.
      'eventType.policy',
      'geography.nearbyRadiusKm',
      'geography.policy',
      // WP-34 (R130), declared by modules/installation.
      'installation.mode',
      'scraper.contactEmail',
      // WP-15b's, declared by modules/search (§8.4).
      'search.ranking.thresholds',
      'search.ranking.weights',
      // WP-11's, declared by modules/sources — secret, never logged or exported.
      'sources.clist.apiKey',
      'sources.clist.apiUsername',
      // pre-M2a's, declared by modules/sources: whether R74's one-time "Connect
      // your sources" step has been through.
      'sources.connectPromptSeenAt',
      // WP-14/R74's, one set per source that may hold the professor's own
      // session. The cookie and its capture time are secret; the state and the
      // last-verified time are what Source status shows.
      'sources.devfolio.sessionCapturedAt',
      'sources.devfolio.sessionCookie',
      'sources.devfolio.sessionState',
      'sources.devfolio.sessionVerifiedAt',
      'sources.unstop.sessionCapturedAt',
      'sources.unstop.sessionCookie',
      'sources.unstop.sessionState',
      'sources.unstop.sessionVerifiedAt',
      // WP-17's, declared by modules/students (Q6, Q8): both off by default.
      'students.allowExternal',
      'students.phoneEnabled',
    ]);

    const { store } = open();
    expect(store.get(AUTO_LOCK_MINUTES)).toBe(15);
    expect(store.get(BACKUP_DAILY_TIME_LOCAL)).toBe('13:00');
    expect(store.get(BACKUP_PUBLIC_KEY)).toBe('');
    expect(store.get(GEOGRAPHY_POLICY)).toStrictEqual({
      inPerson: { allowCountries: ['IN'] },
      online: { allow: 'ALL' },
      hybrid: { evaluate: 'PHYSICAL_LOCATION', ifOutsideAllowed: 'SHOW_AS_ONLINE' },
      unknownLocation: 'SHOW_FLAGGED',
    });
  });

  it('serializes through the schema, so the wizard cannot write an invalid value', () => {
    expect(serialize(AUTO_LOCK_MINUTES, 20)).toBe('20');
    expect(() => serialize(AUTO_LOCK_MINUTES, 0)).toThrow();
    expect(() => serialize(BACKUP_DAILY_TIME_LOCAL, '25:00')).toThrow();
  });
});
