import { describe, expect, it } from 'vitest';

import { AdapterRegistry, registerBuiltInAdapters } from './registry.js';

/** The built-in registry: CTFtime (WP-09b) and CLIST (WP-11). */

const geo = {
  resolve: () => ({ geoPrecision: 'UNKNOWN' as const, warnings: [] }),
  institutionNamed: () => undefined,
};

describe('registerBuiltInAdapters', () => {
  it('registers ctftime as an API adapter with the D-27 cadence and no browser', () => {
    const registry = new AdapterRegistry();
    registerBuiltInAdapters(registry, { geo });
    expect(registry.all().map((adapter) => adapter.key)).toEqual(['ctftime', 'clist']);
    expect(registry.get('clist')).toMatchObject({
      kind: 'CLIST_API',
      needsBrowser: false,
      defaultCadenceMinutes: 30,
    });
    expect('detail' in (registry.get('clist') ?? {})).toBe(false);
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
