import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDir } from '../testing/temp.js';
import { testConfig } from '../testing/harness.js';
import { BUNDLED_NATIVE_BINDING, resolveResources } from './resources.js';
import { StartupError } from './startup-error.js';

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  temps.push(dir);
  return dir;
}

/** A folder shaped like the published bundle: main.mjs, native\, migrations\. */
function fakeBundle(options: { native?: boolean } = {}): string {
  const dir = tempDir('bundle');
  mkdirSync(path.join(dir, 'migrations', 'meta'), { recursive: true });
  writeFileSync(path.join(dir, 'migrations', 'meta', '_journal.json'), '{"entries":[]}');
  if (options.native !== false) {
    mkdirSync(path.join(dir, 'native'), { recursive: true });
    writeFileSync(path.join(dir, BUNDLED_NATIVE_BINDING), 'not really an addon');
  }
  return dir;
}

const entryIn = (dir: string): string => pathToFileURL(path.join(dir, 'main.mjs')).href;

afterEach(() => {
  while (temps.length > 0) {
    removeTempDir(temps.pop() ?? '');
  }
});

describe('resolveResources', () => {
  it('finds migrations and the addon next to a bundled entry point (R17)', () => {
    const dir = fakeBundle();
    const resolved = resolveResources(testConfig(), entryIn(dir));

    expect(resolved.migrationsDir).toBe(path.join(dir, 'migrations'));
    expect(resolved.nativeBinding).toBe(path.join(dir, BUNDLED_NATIVE_BINDING));
  });

  it('leaves the addon to node_modules when the bundle has none', () => {
    const dir = fakeBundle({ native: false });
    expect(resolveResources(testConfig(), entryIn(dir)).nativeBinding).toBeUndefined();
  });

  it('looks one level up, which is where a source checkout keeps migrations', () => {
    const root = tempDir('checkout');
    mkdirSync(path.join(root, 'migrations', 'meta'), { recursive: true });
    writeFileSync(path.join(root, 'migrations', 'meta', '_journal.json'), '{"entries":[]}');
    mkdirSync(path.join(root, 'src'), { recursive: true });

    const resolved = resolveResources(testConfig(), entryIn(path.join(root, 'src')));
    expect(resolved.migrationsDir).toBe(path.join(root, 'src', '..', 'migrations'));
  });

  it('looks two levels up, where a tool under src/tools/ starts (WP-13)', () => {
    const root = tempDir('checkout');
    mkdirSync(path.join(root, 'migrations', 'meta'), { recursive: true });
    writeFileSync(path.join(root, 'migrations', 'meta', '_journal.json'), '{"entries":[]}');
    mkdirSync(path.join(root, 'src', 'tools'), { recursive: true });

    const resolved = resolveResources(testConfig(), entryIn(path.join(root, 'src', 'tools')));
    expect(resolved.migrationsDir).toBe(path.join(root, 'src', 'tools', '..', '..', 'migrations'));
  });

  it('lets the config override both paths', () => {
    const bundle = fakeBundle();
    const override = fakeBundle();
    const config = testConfig({
      migrationsDir: path.join(override, 'migrations'),
      nativeBinding: path.join(override, BUNDLED_NATIVE_BINDING),
    });

    const resolved = resolveResources(config, entryIn(bundle));
    expect(resolved.migrationsDir).toBe(path.join(override, 'migrations'));
    expect(resolved.nativeBinding).toBe(path.join(override, BUNDLED_NATIVE_BINDING));
  });

  it('ignores a config override that does not exist, rather than failing later', () => {
    const bundle = fakeBundle();
    const config = testConfig({ nativeBinding: path.join(bundle, 'nope.node') });
    expect(resolveResources(config, entryIn(bundle)).nativeBinding).toBe(
      path.join(bundle, BUNDLED_NATIVE_BINDING),
    );
  });

  it('fails the start when no migrations folder can be found', () => {
    const dir = tempDir('empty');
    try {
      resolveResources(testConfig(), entryIn(dir));
      expect.unreachable('a build with no migrations folder is incomplete');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).code).toBe('MIGRATION_FAILED');
      expect((error as StartupError).message).toContain('--migrations-dir');
    }
  });

  it('resolves the real backend layout from src/main.ts', () => {
    const entry = pathToFileURL(path.join(import.meta.dirname, '..', 'main.ts')).href;
    const resolved = resolveResources(testConfig(), entry);
    expect(resolved.migrationsDir.endsWith('migrations')).toBe(true);
  });
});
