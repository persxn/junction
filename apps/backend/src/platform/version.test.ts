import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from './version.js';

describe('APP_VERSION', () => {
  it('matches the version in package.json', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect((manifest as { version: string }).version).toBe(APP_VERSION);
  });

  it('is a semver triple', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
