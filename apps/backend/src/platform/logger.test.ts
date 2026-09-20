import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { testConfig } from '../testing/harness.js';
import { createLogger, LOG_RETENTION_FILES } from './logger.js';
import { REDACTED, redactDeep, SENSITIVE_KEY_PATTERN } from './redact.js';
import { DailyRotatingFile } from './rotating-file.js';

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'compintel-logger-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() ?? '', { recursive: true, force: true });
  }
});

describe('redactDeep', () => {
  it.each([
    'password',
    'passwd',
    'passphrase',
    'clientSecret',
    'COMPINTEL_CLIENT_SECRET',
    'accessToken',
    'apiKey',
    'api_key',
    'authorization',
    'x-compintel-client',
    'email',
    'contactEmail',
    'phone',
    'mobileNumber',
  ])('redacts the key %s', (key) => {
    expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(true);
    expect(redactDeep({ [key]: 'sensitive' })[key]).toBe(REDACTED);
  });

  it.each(['author', 'name', 'port', 'dataDir', 'status'])('leaves the key %s alone', (key) => {
    expect(redactDeep({ [key]: 'fine' })[key]).toBe('fine');
  });

  it('redacts nested and array values', () => {
    const result = redactDeep({
      req: { headers: { authorization: 'Bearer abc', host: '127.0.0.1:1' } },
      users: [{ email: 'a@b.c', name: 'A' }],
    });
    expect(result).toStrictEqual({
      req: { headers: { authorization: REDACTED, host: '127.0.0.1:1' } },
      users: [{ email: REDACTED, name: 'A' }],
    });
  });

  it('does not mutate the object it was given', () => {
    const original = { password: 'hunter2' };
    redactDeep(original);
    expect(original.password).toBe('hunter2');
  });

  it('survives a cycle', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(() => redactDeep(node)).not.toThrow();
  });
});

describe('DailyRotatingFile', () => {
  it('writes to one file per local day', () => {
    const dir = tempDir();
    let now = new Date('2026-09-20T10:00:00');
    const file = new DailyRotatingFile({ directory: dir, clock: () => now });

    file.write('day one\n');
    now = new Date('2026-09-21T10:00:00');
    file.write('day two\n');
    file.close();

    expect(readdirSync(dir).sort()).toStrictEqual([
      'backend-2026-09-20.log',
      'backend-2026-09-21.log',
    ]);
    expect(readFileSync(path.join(dir, 'backend-2026-09-20.log'), 'utf8')).toBe('day one\n');
    expect(readFileSync(path.join(dir, 'backend-2026-09-21.log'), 'utf8')).toBe('day two\n');
  });

  it('appends within the same day', () => {
    const dir = tempDir();
    const now = new Date('2026-09-20T10:00:00');
    const file = new DailyRotatingFile({ directory: dir, clock: () => now });
    file.write('a\n');
    file.write('b\n');
    file.close();
    expect(readFileSync(path.join(dir, 'backend-2026-09-20.log'), 'utf8')).toBe('a\nb\n');
  });

  it('creates the directory if it does not exist', () => {
    const dir = path.join(tempDir(), 'logs', 'nested');
    const file = new DailyRotatingFile({ directory: dir, clock: () => new Date('2026-09-20') });
    file.write('x\n');
    file.close();
    expect(readdirSync(dir)).toStrictEqual(['backend-2026-09-20.log']);
  });

  it(`keeps only the newest ${LOG_RETENTION_FILES.toString()} files`, () => {
    const dir = tempDir();
    let day = 1;
    const clock = (): Date => new Date(`2026-03-${day.toString().padStart(2, '0')}T12:00:00`);
    const file = new DailyRotatingFile({ directory: dir, keep: LOG_RETENTION_FILES, clock });

    for (; day <= 20; day += 1) {
      file.write(`day ${day.toString()}\n`);
    }
    file.close();

    const remaining = readdirSync(dir).sort();
    expect(remaining).toHaveLength(LOG_RETENTION_FILES);
    expect(remaining[0]).toBe('backend-2026-03-07.log');
    expect(remaining.at(-1)).toBe('backend-2026-03-20.log');
  });

  it('prunes files left over from an earlier run', () => {
    const dir = tempDir();
    for (let day = 1; day <= 20; day += 1) {
      writeFileSync(
        path.join(dir, `backend-2026-03-${day.toString().padStart(2, '0')}.log`),
        'old',
      );
    }
    writeFileSync(path.join(dir, 'not-a-log.txt'), 'keep me');

    const file = new DailyRotatingFile({
      directory: dir,
      keep: LOG_RETENTION_FILES,
      clock: () => new Date('2026-03-21T00:00:00'),
    });
    file.write('new\n');
    file.close();

    expect(readdirSync(dir)).toContain('not-a-log.txt');
    expect(readdirSync(dir).filter((name) => name.endsWith('.log'))).toHaveLength(
      LOG_RETENTION_FILES,
    );
  });

  it('ignores writes after close', () => {
    const dir = tempDir();
    const file = new DailyRotatingFile({ directory: dir, clock: () => new Date('2026-09-20') });
    file.write('kept\n');
    file.close();
    expect(file.write('dropped\n')).toBe(false);
    expect(readFileSync(path.join(dir, 'backend-2026-09-20.log'), 'utf8')).toBe('kept\n');
  });

  it('refuses a retention of zero', () => {
    expect(() => new DailyRotatingFile({ directory: tempDir(), keep: 0 })).toThrow(RangeError);
  });
});

describe('createLogger', () => {
  it('writes JSON lines into <dataDir>\\logs', () => {
    const dir = tempDir();
    const handle = createLogger(testConfig({ logLevel: 'info' }), { directory: dir });
    handle.logger.info({ port: 4242 }, 'hello');
    handle.close();

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const entry: unknown = JSON.parse(readFileSync(path.join(dir, files[0] ?? ''), 'utf8').trim());
    expect(entry).toMatchObject({ msg: 'hello', port: 4242, level: 30 });
  });

  it('never lets a redacted value reach the log file', () => {
    const dir = tempDir();
    const handle = createLogger(testConfig({ logLevel: 'info' }), { directory: dir });
    handle.logger.info(
      {
        headers: { authorization: 'Bearer super-secret-token', 'x-compintel-client': 'shhh-1234' },
        student: { email: 'student@example.edu', phone: '+91 99999 99999', name: 'Asha' },
        config: { clientSecret: 'do-not-log-me', dataDir: 'C:\\data' },
      },
      'request',
    );
    handle.close();

    const contents = readdirSync(dir)
      .map((name) => readFileSync(path.join(dir, name), 'utf8'))
      .join('');

    for (const leaked of [
      'Bearer super-secret-token',
      'shhh-1234',
      'student@example.edu',
      '+91 99999 99999',
      'do-not-log-me',
    ]) {
      expect(contents).not.toContain(leaked);
    }
    expect(contents).toContain('Asha');
    expect(contents).toContain('C:\\\\data');
    expect(contents.match(new RegExp(REDACTED.replace(/[[\]]/g, '\\$&'), 'g'))).toHaveLength(5);
  });

  it('honours the configured level', () => {
    const dir = tempDir();
    const handle = createLogger(testConfig({ logLevel: 'warn' }), { directory: dir });
    handle.logger.info('dropped');
    handle.logger.warn('kept');
    handle.close();

    const contents = readdirSync(dir)
      .map((name) => readFileSync(path.join(dir, name), 'utf8'))
      .join('');
    expect(contents).not.toContain('dropped');
    expect(contents).toContain('kept');
  });

  it('writes nothing at all when the level is silent', () => {
    const dir = tempDir();
    const handle = createLogger(testConfig({ logLevel: 'silent' }), { directory: dir });
    handle.logger.fatal('not even this');
    handle.close();
    expect(readdirSync(dir)).toStrictEqual([]);
  });

  it('reports the file it is currently writing to', () => {
    const dir = tempDir();
    const handle = createLogger(testConfig({ logLevel: 'info' }), {
      directory: dir,
      clock: () => new Date('2026-09-20T09:00:00'),
    });
    expect(handle.currentFile()).toBeUndefined();
    handle.logger.info('first line');
    expect(handle.currentFile()).toBe(path.join(dir, 'backend-2026-09-20.log'));
    handle.close();
  });
});
