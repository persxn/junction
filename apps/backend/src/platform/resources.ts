import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from './config.js';
import { StartupError } from './startup-error.js';

export interface ResourcePaths {
  /** Folder holding the Drizzle journal and the `.sql` files. */
  readonly migrationsDir: string;
  /**
   * Explicit path to the better-sqlite3 addon, or `undefined` when Node's normal
   * resolution works (a source checkout with `node_modules`).
   */
  readonly nativeBinding: string | undefined;
  /** Explicit path to the Argon2id addon, same rule (R17). */
  readonly argon2Binding: string | undefined;
  /**
   * The shipped read-only gazetteer, or `undefined` when it was not built
   * (ruling R54: that is a warning, never a failure).
   */
  readonly gazetteerFile: string | undefined;
}

/** Files the bundle carries its addons as (ruling R17). */
export const BUNDLED_NATIVE_BINDING = path.join('native', 'better_sqlite3.node');
export const BUNDLED_ARGON2_BINDING = path.join('native', 'argon2.node');

/** Where the packaged backend carries the gazetteer (A20, ruling R53). */
export const BUNDLED_GAZETTEER = path.join('resources', 'gazetteer', 'gazetteer.db');

function firstExisting(candidates: readonly (string | undefined)[]): string | undefined {
  return candidates.find((candidate) => candidate !== undefined && existsSync(candidate));
}

/** `%LOCALAPPDATA%\CompIntel-dev\gazetteer\gazetteer.db`, where the build writes it. */
function devGazetteerFile(): string {
  const localAppData = process.env.LOCALAPPDATA;
  const base =
    localAppData !== undefined && localAppData.length > 0
      ? localAppData
      : path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev', 'gazetteer', 'gazetteer.db');
}

/**
 * Ruling R17: the packaged backend is a single `.mjs` file next to `native\` and
 * `migrations\`, and it runs from a folder with no `node_modules` above it, so
 * neither can be found by module resolution. Both are located relative to the
 * entry point instead, and an explicit config value always wins.
 *
 * In a source checkout the entry is `src/main.ts`, so `../migrations` is the
 * generated folder and the addon is left to `node_modules`.
 */
export function resolveResources(config: Config, entryUrl: string): ResourcePaths {
  const baseDir = path.dirname(fileURLToPath(entryUrl));

  const migrationsDir = firstExisting([
    config.migrationsDir,
    path.join(baseDir, 'migrations'),
    path.join(baseDir, '..', 'migrations'),
  ]);
  if (migrationsDir === undefined) {
    throw new StartupError(
      'MIGRATION_FAILED',
      `No migrations folder next to "${baseDir}". The build is incomplete; ` +
        'pass --migrations-dir to point at one.',
    );
  }

  return {
    migrationsDir,
    nativeBinding: firstExisting([
      config.nativeBinding,
      path.join(baseDir, BUNDLED_NATIVE_BINDING),
    ]),
    argon2Binding: firstExisting([path.join(baseDir, BUNDLED_ARGON2_BINDING)]),
    // A source checkout has it under %LOCALAPPDATA%; a packaged run ships it.
    // Missing is a supported state (R54), so this stays `undefined` rather than
    // throwing the way a missing migrations folder does.
    gazetteerFile: firstExisting([
      path.join(baseDir, BUNDLED_GAZETTEER),
      path.join(baseDir, '..', '..', 'gazetteer', 'gazetteer.db'),
      devGazetteerFile(),
    ]),
  };
}
