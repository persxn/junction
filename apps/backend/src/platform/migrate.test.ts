import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from '../testing/temp.js';
import { ensureDataDirs, dataSubdir, loadConfig, type Config } from './config.js';
import { openDatabase, quickCheck, type DatabaseHandle } from './db.js';
import {
  MIGRATIONS_TABLE,
  PRE_MIGRATION_RETENTION,
  prunePreMigrationCopies,
  recordAppMeta,
  runMigrations,
} from './migrate.js';
import { StartupError } from './startup-error.js';
import { fixedClock } from './time.js';

const silent = pino({ enabled: false });
const SECRET = '0123456789abcdef0123456789abcdef';

const temps: string[] = [];
const open: DatabaseHandle[] = [];

interface MigrationSpec {
  readonly tag: string;
  readonly when: number;
  readonly sql: string;
}

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  temps.push(dir);
  return dir;
}

function dataDir(): Config {
  const config = loadConfig({
    argv: ['--data-dir', tempDir('migrate')],
    env: { COMPINTEL_CLIENT_SECRET: SECRET },
  });
  ensureDataDirs(config);
  return config;
}

/** Writes a Drizzle-shaped migrations folder, which is all the migrator reads. */
function writeMigrations(specs: readonly MigrationSpec[]): string {
  const dir = tempDir('migrations');
  mkdirSync(path.join(dir, 'meta'), { recursive: true });
  writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: specs.map((spec, idx) => ({
        idx,
        version: '6',
        when: spec.when,
        tag: spec.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const spec of specs) {
    writeFileSync(path.join(dir, `${spec.tag}.sql`), spec.sql);
  }
  return dir;
}

const V1: MigrationSpec = {
  tag: '0000_first',
  when: 1_700_000_000_000,
  sql: 'CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);',
};
const V2: MigrationSpec = {
  tag: '0001_second',
  when: 1_700_000_001_000,
  sql: 'CREATE TABLE `b` (`id` text PRIMARY KEY NOT NULL);',
};
const BROKEN: MigrationSpec = {
  tag: '0001_broken',
  when: 1_700_000_001_000,
  sql: 'CREATE TABLE `b` (`id` text PRIMARY KEY NOT NULL);\n--> statement-breakpoint\nTHIS IS NOT SQL;',
};

function openTracked(config: Config): DatabaseHandle {
  const handle = openDatabase(config, { logger: silent });
  open.push(handle);
  return handle;
}

function tableNames(db: DatabaseHandle): string[] {
  return (
    db.raw.prepare(`select name from sqlite_master where type = 'table' order by name`).all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

function backups(config: Config): string[] {
  return readdirSync(dataSubdir(config, 'backups-local')).filter((name) =>
    name.startsWith('pre-migration-'),
  );
}

afterEach(() => {
  while (open.length > 0) {
    open.pop()?.close();
  }
  while (temps.length > 0) {
    removeTempDir(temps.pop() ?? '');
  }
});

describe('runMigrations on a new database', () => {
  it('applies every migration and makes no copy', () => {
    const config = dataDir();
    const db = openTracked(config);
    const result = runMigrations(config, db, {
      migrationsDir: writeMigrations([V1, V2]),
      logger: silent,
    });

    expect(result).toStrictEqual({ applied: 2, total: 2, backupFile: undefined });
    expect(tableNames(db)).toContain('a');
    expect(tableNames(db)).toContain('b');
    expect(tableNames(db)).toContain(MIGRATIONS_TABLE);
    expect(backups(config)).toStrictEqual([]);
  });

  it('is idempotent when run again', () => {
    const config = dataDir();
    const db = openTracked(config);
    const migrationsDir = writeMigrations([V1, V2]);

    runMigrations(config, db, { migrationsDir, logger: silent });
    const second = runMigrations(config, db, { migrationsDir, logger: silent });

    expect(second).toStrictEqual({ applied: 0, total: 2, backupFile: undefined });
    expect(backups(config)).toStrictEqual([]);
  });

  it('survives a restart: reopening and re-running changes nothing', () => {
    const config = dataDir();
    const migrationsDir = writeMigrations([V1]);
    const first = openTracked(config);
    runMigrations(config, first, { migrationsDir, logger: silent });
    first.close();

    const second = openTracked(config);
    expect(runMigrations(config, second, { migrationsDir, logger: silent }).applied).toBe(0);
  });
});

describe('runMigrations on an existing database', () => {
  it('takes one pre-migration copy before applying (F4)', () => {
    const config = dataDir();
    const db = openTracked(config);
    runMigrations(config, db, { migrationsDir: writeMigrations([V1]), logger: silent });
    db.raw.exec(`insert into a (id) values ('real-data')`);

    const result = runMigrations(config, db, {
      migrationsDir: writeMigrations([V1, V2]),
      logger: silent,
    });

    expect(result.applied).toBe(1);
    expect(result.total).toBe(2);
    expect(result.backupFile).toBeDefined();
    expect(backups(config)).toHaveLength(1);
    expect(path.basename(result.backupFile ?? '')).toMatch(/^pre-migration-\d{8}-\d{6}\.db$/);
  });

  it('writes a copy that is itself a healthy database holding the old data', () => {
    const config = dataDir();
    const db = openTracked(config);
    runMigrations(config, db, { migrationsDir: writeMigrations([V1]), logger: silent });
    db.raw.exec(`insert into a (id) values ('before-the-upgrade')`);

    const result = runMigrations(config, db, {
      migrationsDir: writeMigrations([V1, V2]),
      logger: silent,
    });

    const copy = openDatabase(config, { logger: silent, file: result.backupFile ?? '' });
    open.push(copy);
    expect(quickCheck(copy.raw)).toStrictEqual(['ok']);
    expect(tableNames(copy)).toContain('a');
    // The copy predates the upgrade, so the new table must not be in it.
    expect(tableNames(copy)).not.toContain('b');
    expect(copy.raw.prepare('select id from a').get()).toStrictEqual({ id: 'before-the-upgrade' });
  });

  it('keeps only the newest five copies', () => {
    const config = dataDir();
    const backupDir = dataSubdir(config, 'backups-local');
    for (let day = 1; day <= 9; day += 1) {
      writeFileSync(
        path.join(backupDir, `pre-migration-2026090${day.toString()}-120000.db`),
        'older',
      );
    }
    writeFileSync(path.join(backupDir, 'something-else.db'), 'not ours');

    prunePreMigrationCopies(backupDir);

    const remaining = backups(config).sort();
    expect(remaining).toHaveLength(PRE_MIGRATION_RETENTION);
    expect(remaining[0]).toBe('pre-migration-20260905-120000.db');
    expect(remaining.at(-1)).toBe('pre-migration-20260909-120000.db');
    expect(readdirSync(backupDir)).toContain('something-else.db');
  });

  it('prunes as part of a real upgrade', () => {
    const config = dataDir();
    const backupDir = dataSubdir(config, 'backups-local');
    for (let day = 1; day <= 6; day += 1) {
      writeFileSync(
        path.join(backupDir, `pre-migration-2026090${day.toString()}-120000.db`),
        'older',
      );
    }

    const db = openTracked(config);
    runMigrations(config, db, { migrationsDir: writeMigrations([V1]), logger: silent });
    runMigrations(config, db, { migrationsDir: writeMigrations([V1, V2]), logger: silent });

    expect(backups(config)).toHaveLength(PRE_MIGRATION_RETENTION);
  });
});

describe('a migration that fails', () => {
  it('rolls back, reports MIGRATION_FAILED and keeps the copy', () => {
    const config = dataDir();
    const db = openTracked(config);
    runMigrations(config, db, { migrationsDir: writeMigrations([V1]), logger: silent });
    db.raw.exec(`insert into a (id) values ('must survive')`);
    const before = tableNames(db);

    try {
      runMigrations(config, db, {
        migrationsDir: writeMigrations([V1, BROKEN]),
        logger: silent,
      });
      expect.unreachable('a broken migration must not report success');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).code).toBe('MIGRATION_FAILED');
      expect((error as StartupError).message).toContain(BROKEN.tag);
    }

    // Drizzle runs every pending file in one transaction, so nothing landed.
    expect(tableNames(db)).toStrictEqual(before);
    expect(tableNames(db)).not.toContain('b');
    expect(db.raw.prepare('select id from a').get()).toStrictEqual({ id: 'must survive' });
    expect(backups(config)).toHaveLength(1);
  });

  it('reports MIGRATION_FAILED when the journal is missing', () => {
    const config = dataDir();
    const db = openTracked(config);
    try {
      runMigrations(config, db, { migrationsDir: tempDir('no-journal'), logger: silent });
      expect.unreachable('a folder with no journal is not a migrations folder');
    } catch (error) {
      expect((error as StartupError).code).toBe('MIGRATION_FAILED');
    }
  });
});

describe('custom SQL migrations (F6)', () => {
  const CUSTOM: MigrationSpec = {
    tag: '0000_fts',
    when: 1_700_000_000_000,
    sql: [
      'CREATE TABLE `event` (`id` text PRIMARY KEY NOT NULL, `title` text NOT NULL);',
      "CREATE VIRTUAL TABLE `event_fts` USING fts5(title, content='event', content_rowid='rowid', tokenize='trigram');",
      'CREATE TRIGGER `event_ai` AFTER INSERT ON `event` BEGIN\n' +
        '  INSERT INTO `event_fts`(rowid, title) VALUES (new.rowid, new.title);\n' +
        'END;',
    ].join('\n--> statement-breakpoint\n'),
  };

  it('creates an FTS5 table and a trigger drizzle-kit could never infer', () => {
    const config = dataDir();
    const db = openTracked(config);
    runMigrations(config, db, { migrationsDir: writeMigrations([CUSTOM]), logger: silent });

    const objects = db.raw
      .prepare(`select name, type from sqlite_master where name in ('event_fts', 'event_ai')`)
      .all() as { name: string; type: string }[];
    expect(objects).toEqual(
      expect.arrayContaining([
        { name: 'event_fts', type: 'table' },
        { name: 'event_ai', type: 'trigger' },
      ]),
    );
  });

  it('indexes through the trigger and matches on a trigram substring', () => {
    const config = dataDir();
    const db = openTracked(config);
    runMigrations(config, db, { migrationsDir: writeMigrations([CUSTOM]), logger: silent });

    db.raw
      .prepare('insert into event (id, title) values (?, ?)')
      .run('e1', 'Smart India Hackathon 2026');

    const hit = db.raw
      .prepare(`select rowid from event_fts where event_fts match ?`)
      .all('ackatho') as { rowid: number }[];
    expect(hit).toHaveLength(1);

    const miss = db.raw
      .prepare(`select rowid from event_fts where event_fts match ?`)
      .all('robotics');
    expect(miss).toHaveLength(0);
  });
});

describe('recordAppMeta', () => {
  it('stamps the creation time once and the app version every time', () => {
    const config = dataDir();
    const db = openTracked(config);
    runMigrations(config, db, {
      migrationsDir: path.join(import.meta.dirname, '..', '..', 'migrations'),
      logger: silent,
    });

    recordAppMeta(config, db, fixedClock('2026-09-20T09:00:00.000Z'));
    recordAppMeta(config, db, fixedClock('2026-09-21T09:00:00.000Z'));

    const rows = Object.fromEntries(
      (
        db.raw.prepare('select key, value from app_meta').all() as { key: string; value: string }[]
      ).map((row) => [row.key, row.value]),
    );
    expect(rows.schema_created_at).toBe('2026-09-20T09:00:00.000Z');
    expect(rows.last_app_version).toBe(config.appVersion);
  });
});
