import { describe, expect, it } from 'vitest';

import { AdapterRegistry, registerBuiltInAdapters } from './registry.js';

/** WP-09b: the built-in registry is CTFtime's, and nothing else yet. */

const geo = {
  resolve: () => ({ geoPrecision: 'UNKNOWN' as const, warnings: [] }),
  institutionNamed: () => undefined,
};

describe('registerBuiltInAdapters', () => {
  it('registers ctftime as an API adapter with the D-27 cadence and no browser', () => {
    const registry = new AdapterRegistry();
    registerBuiltInAdapters(registry, { geo });
    expect(registry.all().map((adapter) => adapter.key)).toEqual(['ctftime']);
    expect(registry.get('ctftime')).toMatchObject({
      displayName: 'CTFtime',
      kind: 'CTFTIME_API',
      needsBrowser: false,
      defaultCadenceMinutes: 30,
    });
    expect('detail' in (registry.get('ctftime') ?? {})).toBe(true);
  });

  it('refuses to run twice against one registry', () => {
    const registry = new AdapterRegistry();
    registerBuiltInAdapters(registry, { geo });
    expect(() => {
      registerBuiltInAdapters(registry, { geo });
    }).toThrow(/already registered/);
  });
});
