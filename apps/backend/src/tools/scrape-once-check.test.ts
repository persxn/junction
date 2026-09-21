import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SourcesRepository } from '../modules/sources/repository.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import { insertSource, silentLogger } from '../testing/scraping.js';
import { AdapterRegistry, registerBuiltInAdapters } from '../sources/registry.js';
import { parseSourceArg, scrapeOnceRefusal } from './scrape-once-check.js';

/** `scrape:once` refuses before any socket exists (WP-09b BUILD 5). */

let database: MigratedDatabase;
let sources: SourcesRepository;
const registry = new AdapterRegistry();
registerBuiltInAdapters(registry, {
  geo: {
    resolve: () => ({ geoPrecision: 'UNKNOWN', warnings: [] }),
    institutionNamed: () => undefined,
  },
});
const NOW = Date.parse('2026-09-21T10:00:00Z');

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'scrape-once');
  sources = new SourcesRepository(database.db);
});

afterEach(() => {
  database.close();
});

function refusalFor(key: string): string | undefined {
  const source = sources.findByKey(key);
  return scrapeOnceRefusal(source, source && sources.state(source.id, NOW), registry, NOW);
}

describe('parseSourceArg', () => {
  it('reads --source <key> and nothing else', () => {
    expect(parseSourceArg(['--source', 'ctftime'])).toBe('ctftime');
    expect(parseSourceArg(['--', '--source', 'ctftime'])).toBe('ctftime');
    expect(parseSourceArg(['--source'])).toBeUndefined();
    expect(parseSourceArg(['--source', '--dev'])).toBeUndefined();
    expect(parseSourceArg([])).toBeUndefined();
  });
});

describe('scrapeOnceRefusal', () => {
  it('lets the approved, enabled, registered ctftime row run', () => {
    expect(refusalFor('ctftime')).toBeUndefined();
  });

  it.each(['devpost'])('refuses %s, which is MANUAL_IMPORT_ONLY', (key) => {
    expect(refusalFor(key)).toMatch(/MANUAL_IMPORT_ONLY; only APPROVED/);
  });

  it('refuses an approved source that is disabled', () => {
    database.db.raw.prepare("update sources set is_enabled = 0 where key = 'clist'").run();
    expect(refusalFor('clist')).toBe('clist is disabled.');
  });

  it('refuses an approved source with no adapter in this build', () => {
    // Every seeded approved source has an adapter now (WP-12), so one is made up.
    insertSource(database.db, { key: 'campus-demo', adapter: 'CONFIGURED_LISTING' });
    expect(refusalFor('campus-demo')).toBe('campus-demo has no adapter in this build.');
  });

  it('refuses an unknown key', () => {
    expect(refusalFor('nope')).toBe('No such source.');
  });

  it('refuses inside the manual floor', () => {
    const source = sources.findByKey('ctftime')!;
    sources.recordSuccess(source.id, NOW - 60_000, NOW + 30 * 60_000, true);
    expect(refusalFor('ctftime')).toMatch(/ran less than 10 minutes ago/);
  });
});
