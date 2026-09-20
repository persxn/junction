import { existsSync } from 'node:fs';
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
}

/** File the bundle carries its addon as (ruling R17). */
export const BUNDLED_NATIVE_BINDING = path.join('native', 'better_sqlite3.node');

function firstExisting(candidates: readonly (string | undefined)[]): string | undefined {
  return candidates.find((candidate) => candidate !== undefined && existsSync(candidate));
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
  };
}
