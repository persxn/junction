import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from '../testing/temp.js';
import { ensureDataDirs, loadConfig, type Config } from './config.js';
import { acquireDataDirLock, lockPath, LOCK_FILE } from './lock.js';
import { StartupError } from './startup-error.js';

const silent = pino({ enabled: false });
const SECRET = '0123456789abcdef0123456789abcdef';

const temps: string[] = [];
const children: ChildProcess[] = [];

function dataDir(): Config {
  const dir = makeTempDir('lock');
  temps.push(dir);
  const config = loadConfig({
    argv: ['--data-dir', dir],
    env: { COMPINTEL_CLIENT_SECRET: SECRET },
  });
  ensureDataDirs(config);
  return config;
}

/** A real process we did not start ourselves, so `isAlive` has something true to find. */
function spawnIdleProcess(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.on('spawn', () => {
      resolve(child.pid ?? 0);
    });
    child.on('error', reject);
  });
}

/** A pid that is certainly gone: a process we started and waited for. */
function spawnAndReapProcess(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', () => {
      resolve(child.pid ?? 0);
    });
  });
}

afterEach(() => {
  while (children.length > 0) {
    children.pop()?.kill();
  }
  while (temps.length > 0) {
    removeTempDir(temps.pop() ?? '');
  }
});

describe('acquireDataDirLock', () => {
  it('writes backend.lock naming this process', () => {
    const config = dataDir();
    const lock = acquireDataDirLock(config, silent);

    expect(lock.file).toBe(lockPath(config));
    expect(lock.file.endsWith(LOCK_FILE)).toBe(true);
    expect(lock.takenOverFrom).toBeUndefined();

    const body: unknown = JSON.parse(readFileSync(lock.file, 'utf8'));
    expect(body).toStrictEqual({
      pid: process.pid,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
    lock.release();
  });

  it('refuses a data directory another live backend holds', async () => {
    const config = dataDir();
    const alienPid = await spawnIdleProcess();
    writeFileSync(
      lockPath(config),
      JSON.stringify({ pid: alienPid, startedAt: new Date().toISOString() }),
    );

    try {
      acquireDataDirLock(config, silent);
      expect.unreachable('the second backend should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).code).toBe('DATA_DIR_LOCKED');
      expect((error as StartupError).message).toContain(alienPid.toString());
      expect((error as StartupError).message).toContain(config.dataDir);
    }
  });

  it('takes over a stale lock whose process is gone', async () => {
    const config = dataDir();
    const deadPid = await spawnAndReapProcess();
    writeFileSync(
      lockPath(config),
      JSON.stringify({ pid: deadPid, startedAt: '2026-09-19T10:00:00.000Z' }),
    );

    const lock = acquireDataDirLock(config, silent);
    expect(lock.takenOverFrom).toBe(deadPid);
    expect((JSON.parse(readFileSync(lock.file, 'utf8')) as { pid: number }).pid).toBe(process.pid);
    lock.release();
  });

  it.each([
    ['unparsable', 'not json at all'],
    ['the wrong shape', '{"owner":"someone"}'],
    ['an impossible pid', '{"pid":0,"startedAt":"2026-09-19T10:00:00.000Z"}'],
    ['empty', ''],
  ])('takes over a lock file that is %s', (_label, contents) => {
    const config = dataDir();
    writeFileSync(lockPath(config), contents);

    const lock = acquireDataDirLock(config, silent);
    expect((JSON.parse(readFileSync(lock.file, 'utf8')) as { pid: number }).pid).toBe(process.pid);
    lock.release();
  });

  it('lets the same process re-acquire its own lock', () => {
    const config = dataDir();
    const first = acquireDataDirLock(config, silent);
    const second = acquireDataDirLock(config, silent);
    expect(second.takenOverFrom).toBeUndefined();
    second.release();
    first.release();
  });

  it('removes the file on release, and only once', () => {
    const config = dataDir();
    const lock = acquireDataDirLock(config, silent);
    expect(existsSync(lock.file)).toBe(true);

    lock.release();
    expect(existsSync(lock.file)).toBe(false);
    expect(() => {
      lock.release();
    }).not.toThrow();
  });

  it('does not delete a lock another process has since taken', async () => {
    const config = dataDir();
    const lock = acquireDataDirLock(config, silent);
    const alienPid = await spawnIdleProcess();
    writeFileSync(
      lock.file,
      JSON.stringify({ pid: alienPid, startedAt: new Date().toISOString() }),
    );

    lock.release();
    expect(existsSync(lock.file)).toBe(true);
    expect((JSON.parse(readFileSync(lock.file, 'utf8')) as { pid: number }).pid).toBe(alienPid);
  });

  it('reports an unwritable data directory as DATA_DIR_UNUSABLE', () => {
    const config = loadConfig({
      argv: ['--data-dir', `${makeTempDir('lock-missing')}-gone`],
      env: { COMPINTEL_CLIENT_SECRET: SECRET },
    });
    temps.push(config.dataDir);
    try {
      acquireDataDirLock(config, silent);
      expect.unreachable('a missing directory cannot hold a lock');
    } catch (error) {
      expect((error as StartupError).code).toBe('DATA_DIR_UNUSABLE');
    }
  });
});
