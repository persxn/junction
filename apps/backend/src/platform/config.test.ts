import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { API_VERSION } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DATA_SUBDIRS,
  DEV_CONNECTION_FILE,
  dataSubdir,
  ensureDataDirs,
  loadConfig,
  writeDevConnectionFile,
} from './config.js';
import { StartupError } from './startup-error.js';
import { APP_VERSION } from './version.js';

const SECRET = '0123456789abcdef0123456789abcdef';

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'compintel-config-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop() ?? '', { recursive: true, force: true });
  }
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  COMPINTEL_CLIENT_SECRET: SECRET,
  ...extra,
});

describe('loadConfig precedence', () => {
  it('prefers a CLI flag over the environment', () => {
    const config = loadConfig({
      argv: ['--data-dir', 'C:\\from-flag', '--port', '5001'],
      env: env({ COMPINTEL_DATA_DIR: 'C:\\from-env', PORT: '6001' }),
    });
    expect(config.dataDir).toBe(path.resolve('C:\\from-flag'));
    expect(config.port).toBe(5001);
  });

  it('falls back to the environment when no flag is given', () => {
    const config = loadConfig({
      argv: [],
      env: env({ COMPINTEL_DATA_DIR: 'C:\\from-env', PORT: '6001' }),
    });
    expect(config.dataDir).toBe(path.resolve('C:\\from-env'));
    expect(config.port).toBe(6001);
  });

  it('defaults the port to 0 so the OS picks one', () => {
    const config = loadConfig({ argv: ['--data-dir', 'C:\\x'], env: env() });
    expect(config.port).toBe(0);
  });

  it('pins the host to loopback and carries both versions', () => {
    const config = loadConfig({ argv: ['--data-dir', 'C:\\x'], env: env() });
    expect(config.host).toBe('127.0.0.1');
    expect(config.appVersion).toBe(APP_VERSION);
    expect(config.apiVersion).toBe(API_VERSION);
  });

  it('defaults the log level to info, or debug in --dev', () => {
    expect(loadConfig({ argv: ['--data-dir', 'C:\\x'], env: env() }).logLevel).toBe('info');
    expect(loadConfig({ argv: ['--data-dir', 'C:\\x', '--dev'], env: env() }).logLevel).toBe(
      'debug',
    );
  });

  it('prefers --log-level over COMPINTEL_LOG_LEVEL', () => {
    const config = loadConfig({
      argv: ['--data-dir', 'C:\\x', '--log-level', 'warn'],
      env: env({ COMPINTEL_LOG_LEVEL: 'trace' }),
    });
    expect(config.logLevel).toBe('warn');
  });

  it('reads the boolean flags', () => {
    const config = loadConfig({
      argv: ['--data-dir', 'C:\\x', '--dev', '--stdin-lifeline'],
      env: env(),
    });
    expect(config.dev).toBe(true);
    expect(config.stdinLifeline).toBe(true);
  });

  it('resolves a relative data directory to an absolute path', () => {
    const config = loadConfig({ argv: ['--data-dir', 'local-data'], env: env() });
    expect(path.isAbsolute(config.dataDir)).toBe(true);
  });
});

describe('loadConfig validation', () => {
  it('requires a data directory outside --dev', () => {
    expect(() => loadConfig({ argv: [], env: env() })).toThrow(StartupError);
    try {
      loadConfig({ argv: [], env: env() });
    } catch (error) {
      expect((error as StartupError).code).toBe('CONFIG_INVALID');
    }
  });

  it('defaults the data directory to %LOCALAPPDATA%\\CompIntel-dev in --dev', () => {
    const config = loadConfig({
      argv: ['--dev'],
      env: env({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }),
    });
    expect(config.dataDir).toBe(path.resolve('C:\\Users\\x\\AppData\\Local\\CompIntel-dev'));
  });

  it('requires the client secret outside --dev', () => {
    const attempt = (): unknown => loadConfig({ argv: ['--data-dir', 'C:\\x'], env: {} });
    expect(attempt).toThrow(/COMPINTEL_CLIENT_SECRET/);
  });

  it('generates a client secret in --dev and flags that it did', () => {
    const config = loadConfig({ argv: ['--data-dir', 'C:\\x', '--dev'], env: {} });
    expect(config.clientSecret).toHaveLength(64);
    expect(config.clientSecretGenerated).toBe(true);
  });

  it('keeps a supplied secret even in --dev', () => {
    const config = loadConfig({ argv: ['--data-dir', 'C:\\x', '--dev'], env: env() });
    expect(config.clientSecret).toBe(SECRET);
    expect(config.clientSecretGenerated).toBe(false);
  });

  it.each(['abc', '-1', '8080x', '80 80'])('rejects the port %p', (port) => {
    const attempt = (): unknown =>
      loadConfig({ argv: ['--data-dir', 'C:\\x', '--port', port], env: env() });
    expect(attempt).toThrow(StartupError);
  });

  it('treats an empty value as absent, so PORT= does not break a launch', () => {
    const config = loadConfig({
      argv: ['--data-dir', 'C:\\x', '--port', ''],
      env: env({ PORT: '' }),
    });
    expect(config.port).toBe(0);
  });

  it('rejects a port above 65535', () => {
    const attempt = (): unknown =>
      loadConfig({ argv: ['--data-dir', 'C:\\x', '--port', '70000'], env: env() });
    expect(attempt).toThrow(/Invalid configuration/);
  });

  it('rejects an unknown log level', () => {
    const attempt = (): unknown =>
      loadConfig({ argv: ['--data-dir', 'C:\\x', '--log-level', 'chatty'], env: env() });
    expect(attempt).toThrow(/Invalid configuration/);
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    const attempt = (): unknown =>
      loadConfig({ argv: ['--data-dir', 'C:\\x', '--turbo'], env: env() });
    expect(attempt).toThrow(StartupError);
  });

  it('rejects a secret passed on the command line', () => {
    const attempt = (): unknown =>
      loadConfig({ argv: ['--data-dir', 'C:\\x', '--client-secret', SECRET], env: env() });
    expect(attempt).toThrow(StartupError);
  });

  it('returns a frozen object', () => {
    const config = loadConfig({ argv: ['--data-dir', 'C:\\x'], env: env() });
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('ensureDataDirs', () => {
  it('creates every sub-directory the app needs', () => {
    const root = path.join(tempDir(), 'nested', 'data-dir');
    const config = loadConfig({ argv: ['--data-dir', root], env: env() });
    ensureDataDirs(config);
    for (const name of DATA_SUBDIRS) {
      expect(statSync(dataSubdir(config, name)).isDirectory()).toBe(true);
    }
  });

  it('is idempotent', () => {
    const config = loadConfig({ argv: ['--data-dir', tempDir()], env: env() });
    ensureDataDirs(config);
    expect(() => {
      ensureDataDirs(config);
    }).not.toThrow();
  });

  it('leaves no write probe behind', () => {
    const root = tempDir();
    const config = loadConfig({ argv: ['--data-dir', root], env: env() });
    ensureDataDirs(config);
    const leftovers = [root, ...DATA_SUBDIRS.map((name) => dataSubdir(config, name))].flatMap(
      (dir) => readdirSync(dir).filter((entry) => entry.startsWith('.compintel-write-probe')),
    );
    expect(leftovers).toStrictEqual([]);
  });

  it('reports DATA_DIR_UNUSABLE when the path is a file', () => {
    const blocker = path.join(tempDir(), 'not-a-directory');
    writeFileSync(blocker, 'in the way');
    const config = loadConfig({ argv: ['--data-dir', blocker], env: env() });
    try {
      ensureDataDirs(config);
      expect.unreachable('ensureDataDirs should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).code).toBe('DATA_DIR_UNUSABLE');
    }
  });
});

describe('writeDevConnectionFile', () => {
  it('writes the base URL and the secret for WP-06', () => {
    const config = loadConfig({ argv: ['--data-dir', tempDir(), '--dev'], env: {} });
    ensureDataDirs(config);
    const file = writeDevConnectionFile(config, 54321);
    expect(path.basename(file)).toBe(DEV_CONNECTION_FILE);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({
      baseUrl: 'http://127.0.0.1:54321',
      clientSecret: config.clientSecret,
    });
  });

  it('refuses to persist the secret outside --dev', () => {
    const config = loadConfig({ argv: ['--data-dir', tempDir()], env: env() });
    ensureDataDirs(config);
    expect(() => writeDevConnectionFile(config, 1)).toThrow(/--dev/);
  });
});
