import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from '../../testing/temp.js';
import { checkBackupPath, isInside, MIN_FREE_BYTES } from './paths.js';

/**
 * Ruling R43's folder validation. Every refusal names its own reason, because
 * "that folder cannot be used" is not something a user can act on and "it is
 * inside the folder being backed up" is.
 */

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeTempDir(dir);
  }
});

describe('checkBackupPath (ruling R43)', () => {
  it('accepts an ordinary writable folder outside the data directory', () => {
    const dataDir = tempDir('paths-data');
    const backups = tempDir('paths-backups');

    const result = checkBackupPath(backups, { dataDir });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.resolvedPath).toBe(path.resolve(backups));
    expect(result.freeBytes).toBeGreaterThan(0);
  });

  it('refuses a folder that is not there', () => {
    const dataDir = tempDir('paths-data');
    const result = checkBackupPath(path.join(dataDir, '..', 'no-such-folder'), { dataDir });
    expect(result).toMatchObject({ ok: false, reason: 'MISSING' });
  });

  it('refuses a file', () => {
    const dataDir = tempDir('paths-data');
    const parent = tempDir('paths-file');
    const file = path.join(parent, 'not-a-folder.txt');
    writeFileSync(file, 'hello');

    expect(checkBackupPath(file, { dataDir })).toMatchObject({
      ok: false,
      reason: 'NOT_A_DIRECTORY',
    });
  });

  it('refuses the data directory itself and anything under it', () => {
    const dataDir = tempDir('paths-data');
    const inside = path.join(dataDir, 'backups');
    mkdirSync(inside, { recursive: true });

    expect(checkBackupPath(dataDir, { dataDir })).toMatchObject({
      ok: false,
      reason: 'INSIDE_DATA_DIR',
    });
    expect(checkBackupPath(inside, { dataDir })).toMatchObject({
      ok: false,
      reason: 'INSIDE_DATA_DIR',
    });
  });

  it('refuses a drive with less room than a backup will need', () => {
    const dataDir = tempDir('paths-data');
    const backups = tempDir('paths-backups');

    // Nothing has this much free, which is the point.
    const result = checkBackupPath(backups, { dataDir, minFreeBytes: Number.MAX_SAFE_INTEGER });
    expect(result).toMatchObject({ ok: false, reason: 'LOW_SPACE' });
    // The number is reported either way, so the UI can say how much there is.
    expect(result.freeBytes).toBeGreaterThan(0);
  });

  it('asks for a gigabyte by default (§14 keeps three times the last backup)', () => {
    expect(MIN_FREE_BYTES).toBe(1024 * 1024 * 1024);
  });

  it('leaves no probe file behind', () => {
    const dataDir = tempDir('paths-data');
    const backups = tempDir('paths-backups');
    checkBackupPath(backups, { dataDir });
    // The probe is written and removed; a leftover would end up in every backup.
    expect(readdirSync(backups)).toStrictEqual([]);
  });
});

describe('isInside', () => {
  it.each([
    ['C:\\data', 'C:\\data', true],
    ['C:\\data\\sub', 'C:\\data', true],
    ['C:\\data-other', 'C:\\data', false],
    ['C:\\elsewhere', 'C:\\data', false],
  ])('%s inside %s → %s', (candidate, parent, expected) => {
    expect(isInside(candidate, parent)).toBe(expected);
  });
});
