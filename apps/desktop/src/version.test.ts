import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { JUNCTION_VERSION } from './version.js';

/** One version, four places (the installer reads tauri.conf.json, Windows reads Cargo.toml). */
describe('JUNCTION_VERSION', () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('matches package.json, tauri.conf.json and Cargo.toml', () => {
    expect((JSON.parse(read('../package.json')) as { version: string }).version).toBe(
      JUNCTION_VERSION,
    );
    expect((JSON.parse(read('../src-tauri/tauri.conf.json')) as { version: string }).version).toBe(
      JUNCTION_VERSION,
    );
    expect(read('../src-tauri/Cargo.toml')).toContain(`version = "${JUNCTION_VERSION}"`);
  });
});
