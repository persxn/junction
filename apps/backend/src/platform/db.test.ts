import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from '../testing/temp.js';
import { ensureDataDirs, loadConfig, type Config } from './config.js';
import {
  databaseFile,
  EXPECTED_PRAGMA_VALUES,
  openDatabase,
  quickCheck,
  readPragmas,
  REQUIRED_PRAGMAS,
  type DatabaseHandle,
} from './db.js';
import { ShutdownRegistry } from './shutdown.js';
import { StartupError } from './startup-error.js';

const silent = pino({ enabled: false });
const SECRET = '0123456789abcdef0123456789abcdef';

const temps: string[] = [];
const open: DatabaseHandle[] = [];

function dataDir(): Config {
  const dir = makeTempDir('db');
  temps.push(dir);
  const config = loadConfig({
    argv: ['--data-dir', dir],
    env: { COMPINTEL_CLIENT_SECRET: SECRET },
  });
  ensureDataDirs(config);
  return config;
}

function openTracked(config: Config, extra: Partial<Parameters<typeof openDatabase>[1]> = {}) {
  const handle = openDatabase(config, { logger: silent, ...extra });
  open.push(handle);
  return handle;
}

afterEach(() => {
  while (open.length > 0) {
    open.pop()?.close();
  }
  while (temps.length > 0) {
    removeTempDir(temps.pop() ?? '');
  }
});

describe('openDatabase', () => {
  it('creates the file under <dataDir>\\data', () => {
    const config = dataDir();
    const db = openTracked(config);
    expect(db.file).toBe(databaseFile(config));
    expect(db.file).toBe(path.join(config.dataDir, 'data', 'app.db'));
    expect(existsSync(db.file)).toBe(true);
    expect(db.isHealthy()).toBe(true);
  });

  it('applies every R16 pragma and reads it back', () => {
    const db = openTracked(dataDir());
    const actual = readPragmas(db.raw);
    for (const [name] of REQUIRED_PRAGMAS) {
      expect(actual[name]).toBe(EXPECTED_PRAGMA_VALUES[name]);
    }
  });

  it('is in WAL mode, which is what makes the single-writer rule safe', () => {
    const db = openTracked(dataDir());
    db.raw.exec('create table t (a integer)');
    db.raw.exec('insert into t values (1)');
    expect(existsSync(`${db.file}-wal`)).toBe(true);
  });

  it('enforces foreign keys, which SQLite defaults to off per connection', () => {
    const db = openTracked(dataDir());
    db.raw.exec('create table parent (id integer primary key)');
    db.raw.exec(
      'create table child (id integer primary key, parent_id integer references parent(id))',
    );
    expect(() => {
      db.raw.exec('insert into child values (1, 999)');
    }).toThrow(/FOREIGN KEY/i);
  });

  it('passes quick_check on a healthy file', () => {
    const db = openTracked(dataDir());
    expect(quickCheck(db.raw)).toStrictEqual(['ok']);
  });

  it('fails the start with DB_CORRUPT when quick_check complains', () => {
    const config = dataDir();
    try {
      openTracked(config, {
        integrityCheck: () => [
          '*** in database main ***',
          'Page 3: btreeInitPage() returns error code 11',
        ],
      });
      expect.unreachable('a corrupt database must not open');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).code).toBe('DB_CORRUPT');
      expect((error as StartupError).message).toContain('quick_check');
    }
  });

  it('closes the handle when quick_check fails, leaving no WAL behind', () => {
    const config = dataDir();
    expect(() => openTracked(config, { integrityCheck: () => ['broken'] })).toThrow(StartupError);
    expect(existsSync(`${databaseFile(config)}-wal`)).toBe(false);
  });

  it('reports DB_OPEN_FAILED when the file cannot be opened', () => {
    const config = dataDir();
    const missing = path.join(config.dataDir, 'no-such-folder', 'app.db');
    try {
      openTracked(config, { file: missing });
      expect.unreachable('a database in a missing folder cannot open');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).code).toBe('DB_OPEN_FAILED');
      expect((error as StartupError).message).toContain(missing);
    }
  });
});

describe('shutdown hook', () => {
  it('registers itself in the resources phase (R14)', () => {
    const shutdown = new ShutdownRegistry();
    openTracked(dataDir(), { shutdown });
    expect(shutdown.names('resources')).toStrictEqual(['database']);
    expect(shutdown.names('streams')).toStrictEqual([]);
  });

  it('checkpoints the WAL away and closes the handle', async () => {
    const shutdown = new ShutdownRegistry();
    const db = openTracked(dataDir(), { shutdown });
    db.raw.exec('create table t (a text)');
    db.raw.exec("insert into t values ('something to write ahead')");
    expect(statSync(`${db.file}-wal`).size).toBeGreaterThan(0);

    expect(await shutdown.runPhase('resources', silent)).toBe(0);

    expect(db.isHealthy()).toBe(false);
    // TRUNCATE leaves a zero-length WAL, or none at all once the handle closes.
    expect(existsSync(`${db.file}-wal`) ? statSync(`${db.file}-wal`).size : 0).toBe(0);
  });

  it('is idempotent, so a double shutdown is harmless', () => {
    const db = openTracked(dataDir());
    db.close();
    expect(() => {
      db.close();
    }).not.toThrow();
    expect(db.isHealthy()).toBe(false);
  });

  it('leaves app.db self-contained after the checkpoint', () => {
    const config = dataDir();
    const db = openTracked(config);
    db.raw.exec('create table t (a text)');
    db.raw.exec("insert into t values ('kept')");
    db.close();

    const reopened = openTracked(config);
    const row = reopened.raw.prepare('select a from t').get() as { a: string };
    expect(row.a).toBe('kept');
  });
});
