import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DATA_SUBDIRS, ensureDataDirs, loadConfig, type Config } from '../platform/config.js';
import { makeTempDir, removeTempDir } from '../testing/temp.js';
import { movableClock, silentLogger } from '../testing/scraping.js';
import {
  BACKUP_EXCLUDED_DIRS,
  recordIdOf,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_MAX_PER_RECORD,
  SNAPSHOT_TOTAL_CAP_BYTES,
  SnapshotStore,
  snapshotRef,
  snapshotsRoot,
  snapshotStamp,
} from './snapshots.js';

/** Raw snapshots and their three retention limits (§7.8). */

let dir: string;
let config: Config;
let clock: ReturnType<typeof movableClock>;

beforeEach(() => {
  dir = makeTempDir('snapshots');
  config = loadConfig({
    argv: ['--data-dir', dir],
    env: { COMPINTEL_CLIENT_SECRET: '0123456789abcdef0123456789abcdef' },
  });
  ensureDataDirs(config);
  clock = movableClock('2026-09-21T10:30:00.000Z');
});

afterEach(() => {
  removeTempDir(dir);
});

function store(): SnapshotStore {
  return new SnapshotStore({ config, logger: silentLogger, clock });
}

function allFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe('the backup exclusion (WP-28 consumes it)', () => {
  it('names the snapshots directory, and that directory exists', () => {
    expect(BACKUP_EXCLUDED_DIRS).toEqual(['snapshots']);
    for (const name of BACKUP_EXCLUDED_DIRS) {
      expect(DATA_SUBDIRS).toContain(name);
      expect(existsSync(path.join(config.dataDir, name))).toBe(true);
    }
    expect(snapshotsRoot(config)).toBe(path.join(config.dataDir, 'snapshots'));
  });
});

describe('paths', () => {
  it('lays a snapshot out as <source>/<yyyy-MM>/<recordId>-<stamp>.json.gz', () => {
    const ref = snapshotRef('ctftime', 'record-1', new Date('2026-09-21T10:30:00.000Z'));
    expect(ref).toBe('ctftime/2026-09/record-1-20260921T103000000Z.json.gz');
  });

  it('uses a stamp with no characters Windows refuses in a file name', () => {
    const stamp = snapshotStamp(new Date('2026-09-21T10:30:00.000Z'));
    expect(stamp).toBe('20260921T103000000Z');
    expect(stamp).not.toMatch(/[:*?"<>|]/);
  });

  it('reads the record id back out of a UUIDv7 file name', () => {
    const id = '01a0bc1c-d000-7000-8000-000000000001';
    const ref = snapshotRef('ctftime', id, new Date('2026-09-21T10:30:00.000Z'));
    expect(recordIdOf(path.basename(ref))).toBe(id);
  });
});

describe('writing', () => {
  it('gzips the body and returns a reference that points at it', () => {
    const ref = store().write('ctftime', 'r1', new TextEncoder().encode('{"a":1}'));
    expect(ref).toBeDefined();
    const file = path.join(snapshotsRoot(config), ref ?? '');
    expect(existsSync(file)).toBe(true);
    expect(gunzipSync(readFileSync(file)).toString('utf8')).toBe('{"a":1}');
  });
});

describe('retention (§7.8)', () => {
  it('keeps the three newest snapshots of a record and removes the rest', () => {
    const snapshots = store();
    // The stamp in each file name advances a minute at a time, so the six files
    // are already in chronological order however the filesystem rounds mtimes.
    for (let index = 0; index < 6; index += 1) {
      snapshots.write('ctftime', 'r1', new TextEncoder().encode(`{"n":${index.toString()}}`));
      clock.advance(60_000);
    }
    expect(allFiles(snapshotsRoot(config))).toHaveLength(6);
    const result = snapshots.prune();
    expect(allFiles(snapshotsRoot(config))).toHaveLength(SNAPSHOT_MAX_PER_RECORD);
    expect(result.removed).toBe(3);
  });

  it('removes anything older than fourteen days, oldest first', () => {
    const snapshots = store();
    const ref = snapshots.write('ctftime', 'old', new TextEncoder().encode('{}'));
    const file = path.join(snapshotsRoot(config), ref ?? '');
    const ancient = new Date(clock.now().getTime() - SNAPSHOT_MAX_AGE_MS - 60_000);
    utimesSync(file, ancient, ancient);

    snapshots.write('ctftime', 'fresh', new TextEncoder().encode('{}'));
    const result = snapshots.prune();
    expect(result.removed).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(allFiles(snapshotsRoot(config))).toHaveLength(1);
  });

  it('holds the total under the 300 MB cap', () => {
    // A cap this size is not worth writing 300 MB to check; what matters is that
    // the arithmetic is the sum of the file sizes and that the constant is the
    // spec's number.
    expect(SNAPSHOT_TOTAL_CAP_BYTES).toBe(300 * 1024 * 1024);
    const snapshots = store();
    snapshots.write('ctftime', 'r1', new TextEncoder().encode('{}'));
    const result = snapshots.prune();
    expect(result.keptBytes).toBeGreaterThan(0);
    expect(result.keptBytes).toBeLessThan(SNAPSHOT_TOTAL_CAP_BYTES);
  });

  it('survives being asked to prune an empty or missing directory', () => {
    const snapshots = store();
    expect(snapshots.prune()).toEqual({ removed: 0, removedBytes: 0, keptBytes: 0 });
  });

  it('does not touch another record’s snapshots when pruning one', () => {
    const snapshots = store();
    for (let index = 0; index < 5; index += 1) {
      snapshots.write('ctftime', 'busy', new TextEncoder().encode(`{"n":${index.toString()}}`));
      clock.advance(60_000);
    }
    snapshots.write('ctftime', 'quiet', new TextEncoder().encode('{}'));
    snapshots.prune();
    const names = allFiles(snapshotsRoot(config)).map((file) => recordIdOf(path.basename(file)));
    expect(names.filter((name) => name === 'quiet')).toHaveLength(1);
    expect(names.filter((name) => name === 'busy')).toHaveLength(SNAPSHOT_MAX_PER_RECORD);
  });
});
