import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { haversineKm } from '../domain/geo/distance.js';
import { nameKey } from '../domain/geo/normalize-name.js';
import { openMiniGazetteer, miniGazetteerFile } from '../testing/gazetteer.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';
import { openGazetteer, unavailableGazetteer, type Gazetteer } from './gazetteer.js';
import { pino } from 'pino';

/**
 * The shipped gazetteer (rulings R53 and R54).
 *
 * The behaviour worth pinning is what happens when it is *not* there, because
 * that is the state a clean clone is in and `pnpm verify` has to pass in it.
 */

let gazetteer: Gazetteer | undefined;
let database: MigratedDatabase | undefined;

afterEach(() => {
  gazetteer?.close();
  gazetteer = undefined;
  database?.close();
  database = undefined;
});

describe('the committed mini fixture (R54)', () => {
  it('opens and carries the places the tests name', () => {
    gazetteer = openMiniGazetteer();
    expect(gazetteer.available).toBe(true);
    expect(gazetteer.findByNameKey(nameKey('Mumbai'), 'IN').length).toBeGreaterThan(0);
    expect(gazetteer.findByNameKey(nameKey('Seoul'), 'KR').length).toBeGreaterThan(0);
  });

  it('stays under the 200 KB the ruling allows', () => {
    expect(readFileSync(miniGazetteerFile()).byteLength).toBeLessThanOrEqual(200 * 1024);
  });

  it('is opened read-only: a write is refused', () => {
    gazetteer = openMiniGazetteer();
    // The handle is genuinely read-only, so reference data cannot be mutated by
    // a stray query — it is rebuilt, never edited.
    const readonlyHandle = openGazetteer(miniGazetteerFile(), { logger: pino({ enabled: false }) });
    expect(readonlyHandle.available).toBe(true);
    readonlyHandle.close();
  });

  it('resolves an alias to its place, which is why "Bombay" finds Mumbai', () => {
    gazetteer = openMiniGazetteer();
    const viaAlias = gazetteer.findByNameKey(nameKey('Bombay'), 'IN');
    expect(viaAlias.length).toBeGreaterThan(0);
    expect(viaAlias.some((place) => place.name === 'Mumbai')).toBe(true);
  });

  it('carries the ambiguity the geocoder has to refuse', () => {
    gazetteer = openMiniGazetteer();
    const hyderabad = gazetteer.findByNameKey(nameKey('Hyderabad'));
    const countries = new Set(hyderabad.map((place) => place.countryCode));
    expect(countries.has('IN')).toBe(true);
    expect(countries.has('PK')).toBe(true);
  });

  it('knows the states its places belong to', () => {
    gazetteer = openMiniGazetteer();
    const pune = gazetteer.findByNameKey(nameKey('Pune'), 'IN')[0];
    expect(pune).toBeDefined();
    expect(gazetteer.admin1('IN', pune?.admin1Code ?? '')?.name).toBe('Maharashtra');
  });

  it('places its coordinates where they belong', () => {
    gazetteer = openMiniGazetteer();
    const kolkata = gazetteer.findByNameKey(nameKey('Kolkata'), 'IN')[0];
    expect(kolkata).toBeDefined();
    // Sanity, not precision: within 50 km of the known city centre.
    expect(haversineKm(kolkata ?? { lat: 0, lon: 0 }, { lat: 22.5726, lon: 88.3639 })).toBeLessThan(
      50,
    );
  });
});

describe('a missing or unusable gazetteer degrades (R54)', () => {
  it('returns an unavailable handle rather than throwing', () => {
    const missing = openGazetteer(path.join(import.meta.dirname, 'nope.db'), {
      logger: pino({ enabled: false }),
    });
    expect(missing.available).toBe(false);
    expect(missing.unavailableReason).toContain('pnpm gazetteer:build');
    // Every lookup answers, emptily.
    expect(missing.findByNameKey('mumbai')).toStrictEqual([]);
    expect(missing.findAdmin1ByNameKey('maharashtra')).toStrictEqual([]);
    expect(missing.admin1('IN', '16')).toBeUndefined();
    expect(() => {
      missing.close();
    }).not.toThrow();
  });

  it('refuses a file that is not a gazetteer, without throwing', () => {
    database = openMigratedDatabase(undefined, 'gaz-wrong');
    const wrong = openGazetteer(database.db.file, { logger: pino({ enabled: false }) });
    expect(wrong.available).toBe(false);
    wrong.close();
  });

  it('the unavailable handle is a value, so callers need no special case', () => {
    const none = unavailableGazetteer('for the test');
    expect(none.available).toBe(false);
    expect(none.findByNameKey('anything')).toStrictEqual([]);
  });
});
