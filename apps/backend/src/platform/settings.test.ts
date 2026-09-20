import { afterEach, describe, expect, it, vi } from 'vitest';

import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import { defaultSetting, SETTING_KEYS, SettingsStore } from './settings.js';

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(now = (): number => 1_700_000_000_000): {
  store: SettingsStore;
  invalid: ReturnType<typeof vi.fn>;
  database: MigratedDatabase;
} {
  database = openMigratedDatabase(undefined, 'settings');
  const invalid = vi.fn();
  return { store: new SettingsStore(database.db, { now, onInvalid: invalid }), invalid, database };
}

describe('the typed setting registry (§6.2)', () => {
  it('reads a default for a key that has never been written', () => {
    const { store } = open();
    expect(store.get('auth.autoLockMinutes')).toBe(15);
    expect(defaultSetting('auth.autoLockMinutes')).toBe(15);
  });

  it('round-trips a value', () => {
    const { store } = open();
    store.set('auth.autoLockMinutes', 30, 'user-1');
    expect(store.get('auth.autoLockMinutes')).toBe(30);
  });

  it('overwrites rather than duplicating', () => {
    const { store, database: h } = open();
    store.set('auth.autoLockMinutes', 20);
    store.set('auth.autoLockMinutes', 25);
    const rows = h.db.raw.prepare('SELECT count(*) as n FROM settings').get() as { n: number };
    expect(rows.n).toBe(1);
    expect(store.get('auth.autoLockMinutes')).toBe(25);
  });

  it('records who changed it and when', () => {
    const { store, database: h } = open(() => 1_700_000_000_000);
    store.set('auth.autoLockMinutes', 30, 'user-7');
    const row = h.db.raw
      .prepare('SELECT * FROM settings WHERE key = ?')
      .get('auth.autoLockMinutes') as {
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
      store.set('auth.autoLockMinutes', 0);
    }).toThrow();
    expect(() => {
      store.set('auth.autoLockMinutes', 10_000);
    }).toThrow();
    // Nothing landed, so the default still applies.
    expect(store.get('auth.autoLockMinutes')).toBe(15);
  });

  it('falls back to the default when a stored value does not parse', () => {
    const { store, invalid, database: h } = open();
    h.db.raw
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?,?,?)')
      .run('auth.autoLockMinutes', 'not json', 1);
    expect(store.get('auth.autoLockMinutes')).toBe(15);
    expect(invalid).toHaveBeenCalledWith('auth.autoLockMinutes', 'the stored value is not JSON');
  });

  it('falls back to the default when a stored value is the wrong shape', () => {
    const { store, invalid, database: h } = open();
    h.db.raw
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?,?,?)')
      .run('auth.autoLockMinutes', '"fifteen"', 1);
    expect(store.get('auth.autoLockMinutes')).toBe(15);
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('lists the keys it knows', () => {
    expect([...SETTING_KEYS]).toContain('auth.autoLockMinutes');
  });
});
