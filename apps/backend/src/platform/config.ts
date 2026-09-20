import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { API_VERSION } from '@compintel/contracts';
import { z } from 'zod';

import { StartupError } from './startup-error.js';
import { APP_VERSION } from './version.js';

/** pino levels, plus `silent`. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const LogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevel>;

/** Sub-directories created under `dataDir`, each checked writable at startup. */
export const DATA_SUBDIRS = ['data', 'logs', 'tmp', 'backups-local', 'snapshots'] as const;

/** Name of the file `--dev` writes so WP-06 can find a backend started by hand. */
export const DEV_CONNECTION_FILE = 'dev-connection.json';

const ConfigSchema = z.object({
  /** Absolute path; holds `data`, `logs`, `tmp`, `backups-local`, `snapshots`. */
  dataDir: z.string().min(1),
  /** Never configurable: the API is loopback-only (ARCHITECTURE.md 10.3). */
  host: z.literal('127.0.0.1'),
  /** 0 asks the OS for a free port, which is what the shell does (3.2). */
  port: z.int().min(0).max(65535),
  /** Shared secret for the `X-CompIntel-Client` header (ADR-0017). */
  clientSecret: z.string().min(16),
  /** True when `--dev` generated the secret, so main.ts writes the connection file. */
  clientSecretGenerated: z.boolean(),
  dev: z.boolean(),
  /** Exit gracefully once stdin reaches end of file, i.e. the shell died (A17). */
  stdinLifeline: z.boolean(),
  logLevel: LogLevel,
  /**
   * Explicit path to the better-sqlite3 `.node` addon (ruling R17). Only set when
   * the caller knows better than the bundle-relative default, e.g. a test.
   */
  nativeBinding: z.string().min(1).optional(),
  /** Explicit path to the Drizzle migrations folder; defaults to bundle-relative. */
  migrationsDir: z.string().min(1).optional(),
  appVersion: z.string().min(1),
  apiVersion: z.string().min(1),
});

export type Config = Readonly<z.infer<typeof ConfigSchema>>;

export interface ConfigSources {
  /** Argument list without the node/script entries, i.e. `process.argv.slice(2)`. */
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

const CLI_OPTIONS = {
  'data-dir': { type: 'string' },
  port: { type: 'string' },
  'log-level': { type: 'string' },
  'native-binding': { type: 'string' },
  'migrations-dir': { type: 'string' },
  dev: { type: 'boolean' },
  'stdin-lifeline': { type: 'boolean' },
} as const;

function parseCli(argv: readonly string[]): Partial<Record<keyof typeof CLI_OPTIONS, unknown>> {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: CLI_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    return values;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new StartupError('CONFIG_INVALID', message, { cause });
  }
}

function parsePort(raw: string, origin: string): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new StartupError('CONFIG_INVALID', `${origin} must be a whole number, got "${raw}".`);
  }
  return Number.parseInt(raw, 10);
}

/** `%LOCALAPPDATA%\CompIntel-dev`, with a home-directory fallback for non-Windows CI. */
function devDataDir(env: NodeJS.ProcessEnv): string {
  const localAppData = env.LOCALAPPDATA;
  const base =
    localAppData !== undefined && localAppData.length > 0
      ? localAppData
      : path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev');
}

function firstDefined(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

/**
 * Builds the process configuration. Precedence is CLI flags > environment >
 * defaults. Throws {@link StartupError} rather than exiting, so tests and
 * `main.ts` decide what to do with the failure.
 *
 * The client secret is deliberately environment-only: a command line is visible
 * to every other process on the machine.
 */
export function loadConfig(sources: ConfigSources = {}): Config {
  const env = sources.env ?? process.env;
  const flags = parseCli(sources.argv ?? process.argv.slice(2));

  const dev = flags.dev === true;
  const stdinLifeline = flags['stdin-lifeline'] === true;

  const dataDirRaw = firstDefined(
    flags['data-dir'] as string | undefined,
    env.COMPINTEL_DATA_DIR,
    dev ? devDataDir(env) : undefined,
  );
  if (dataDirRaw === undefined) {
    throw new StartupError(
      'CONFIG_INVALID',
      'A data directory is required: pass --data-dir <path> or set COMPINTEL_DATA_DIR.',
    );
  }

  const portFlag = flags.port as string | undefined;
  const portRaw = firstDefined(portFlag, env.PORT);
  const port =
    portRaw === undefined
      ? 0
      : parsePort(portRaw, portFlag !== undefined && portFlag.length > 0 ? '--port' : 'PORT');

  const envSecret = env.COMPINTEL_CLIENT_SECRET;
  const hasEnvSecret = envSecret !== undefined && envSecret.length > 0;
  if (!hasEnvSecret && !dev) {
    throw new StartupError(
      'CONFIG_INVALID',
      'COMPINTEL_CLIENT_SECRET is required; it is generated per backend spawn (ADR-0017).',
    );
  }
  const clientSecret = hasEnvSecret ? envSecret : randomBytes(32).toString('hex');

  const logLevel = firstDefined(
    flags['log-level'] as string | undefined,
    env.COMPINTEL_LOG_LEVEL,
    dev ? 'debug' : 'info',
  );

  const nativeBinding = firstDefined(
    flags['native-binding'] as string | undefined,
    env.COMPINTEL_SQLITE_NATIVE_BINDING,
  );
  const migrationsDir = firstDefined(
    flags['migrations-dir'] as string | undefined,
    env.COMPINTEL_MIGRATIONS_DIR,
  );

  const candidate = {
    dataDir: path.resolve(dataDirRaw),
    host: '127.0.0.1',
    port,
    clientSecret,
    clientSecretGenerated: !hasEnvSecret,
    dev,
    stdinLifeline,
    logLevel,
    ...(nativeBinding === undefined ? {} : { nativeBinding: path.resolve(nativeBinding) }),
    ...(migrationsDir === undefined ? {} : { migrationsDir: path.resolve(migrationsDir) }),
    appVersion: APP_VERSION,
    apiVersion: API_VERSION,
  };

  const parsed = ConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new StartupError('CONFIG_INVALID', `Invalid configuration - ${detail}`);
  }
  return Object.freeze(parsed.data);
}

/** Absolute path of one of the standard sub-directories. */
export function dataSubdir(config: Config, name: (typeof DATA_SUBDIRS)[number]): string {
  return path.join(config.dataDir, name);
}

function assertWritable(dir: string): void {
  const probe = path.join(dir, `.compintel-write-probe-${process.pid.toString()}`);
  try {
    writeFileSync(probe, '');
  } catch (cause) {
    throw new StartupError(
      'DATA_DIR_UNUSABLE',
      `Cannot write inside "${dir}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  } finally {
    rmSync(probe, { force: true });
  }
}

/**
 * Creates `dataDir` and its sub-directories and proves each one is writable.
 * A write probe is used instead of `fs.access`, whose W_OK check is meaningless
 * on Windows.
 */
export function ensureDataDirs(config: Config): void {
  for (const dir of [config.dataDir, ...DATA_SUBDIRS.map((name) => dataSubdir(config, name))]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (cause) {
      throw new StartupError(
        'DATA_DIR_UNUSABLE',
        `Cannot create "${dir}": ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    assertWritable(dir);
  }
}

/**
 * Writes `<dataDir>\dev-connection.json` so a developer-launched backend can be
 * found by the UI (WP-06). Only ever called in `--dev`: in a packaged run the
 * shell owns the secret and nothing may persist it.
 */
export function writeDevConnectionFile(config: Config, port: number): string {
  if (!config.dev) {
    throw new StartupError(
      'STARTUP_FAILED',
      'Refusing to write dev-connection.json outside --dev mode.',
    );
  }
  const file = path.join(config.dataDir, DEV_CONNECTION_FILE);
  const body = {
    baseUrl: `http://${config.host}:${port.toString()}`,
    clientSecret: config.clientSecret,
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}
