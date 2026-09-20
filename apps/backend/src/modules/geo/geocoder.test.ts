import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../../platform/audit.js';
import { unavailableGazetteer } from '../../platform/gazetteer.js';
import { fixedClock } from '../../platform/time.js';
import { openMigratedDatabase, type MigratedDatabase } from '../../testing/database.js';
import { openMiniGazetteer } from '../../testing/gazetteer.js';
import { Geocoder } from './geocoder.js';
import { loadInstitutions, seedInstitutions } from './seed.js';

/**
 * The geocoding ladder (ruling R55), one case per rung.
 *
 * The rungs below `EXACT` are all "we know roughly where this is", and the
 * product depends on knowing *how* roughly: a CITY-precision coordinate is a
 * town centre, and a distance filter that treats it as a venue tells a professor
 * something it cannot know. So every case asserts the precision as carefully as
 * the coordinates.
 */

const clock = fixedClock('2026-09-20T09:00:00.000Z');

let database: MigratedDatabase | undefined;
let gazetteer: ReturnType<typeof openMiniGazetteer> | undefined;
let geocoder: Geocoder;

beforeEach(() => {
  database = openMigratedDatabase(undefined, 'geocoder');
  seedInstitutions(database.db, new AuditLog(database.db, { clock }), { clock });
  gazetteer = openMiniGazetteer();
  geocoder = new Geocoder({ gazetteer, institutions: loadInstitutions(database.db) });
});

afterEach(() => {
  gazetteer?.close();
  gazetteer = undefined;
  database?.close();
  database = undefined;
  vi.restoreAllMocks();
});

describe('the ladder, rung by rung', () => {
  it('source coordinates → EXACT', () => {
    const result = geocoder.resolve({
      lat: 19.0759,
      lon: 72.8777,
      city: 'Mumbai',
      countryCode: 'IN',
    });
    expect(result.geoPrecision).toBe('EXACT');
    expect(result.lat).toBe(19.0759);
    expect(result.lon).toBe(72.8777);
  });

  it('an institution the seed knows → INSTITUTION, when the seed has its campus', () => {
    const result = geocoder.resolve({
      venueName: 'Indian Institute of Technology Bombay',
      countryCode: 'IN',
    });
    expect(result.geoPrecision).toBe('INSTITUTION');
    expect(result.institutionId).toBeDefined();
    // The committed seed's IIT Bombay campus coordinate, from GeoNames.
    expect(result.lat).toBeCloseTo(19.127, 2);
  });

  it('an alias finds the same institution', () => {
    const viaAlias = geocoder.resolve({ venueName: 'IITB', countryCode: 'IN' });
    const viaName = geocoder.resolve({
      venueName: 'Indian Institute of Technology Bombay',
      countryCode: 'IN',
    });
    expect(viaAlias.institutionId).toBe(viaName.institutionId);
  });

  /**
   * R55: a seed row whose coordinates are a city centroid is marked as such and
   * yields CITY, not INSTITUTION. Most of the seed is like this, because
   * GeoNames carries almost no Indian campus features.
   */
  it('a CITY-precision seed row → CITY, not INSTITUTION', () => {
    const result = geocoder.resolve({
      venueName: 'National Institute of Technology Durgapur',
      countryCode: 'IN',
    });
    expect(result.institutionId).toBeDefined();
    expect(result.geoPrecision).toBe('CITY');
  });

  it('city + state → CITY', () => {
    const result = geocoder.resolve({ city: 'Pune', state: 'Maharashtra', countryCode: 'IN' });
    expect(result.geoPrecision).toBe('CITY');
    expect(result.city).toBe('Pune');
    expect(result.state).toBe('Maharashtra');
    expect(result.lat).toBeCloseTo(18.52, 1);
  });

  it('an unambiguous city alone → CITY', () => {
    const result = geocoder.resolve({ city: 'Bengaluru', countryCode: 'IN' });
    expect(result.geoPrecision).toBe('CITY');
    expect(result.lat).toBeCloseTo(12.97, 1);
  });

  it('a state alone → STATE', () => {
    const result = geocoder.resolve({ state: 'Kerala', countryCode: 'IN' });
    expect(result.geoPrecision).toBe('STATE');
    expect(result.state).toBe('Kerala');
    expect(result.countryCode).toBe('IN');
  });

  it('a country alone → COUNTRY', () => {
    const result = geocoder.resolve({ countryCode: 'IN' });
    expect(result.geoPrecision).toBe('COUNTRY');
    expect(result.countryCode).toBe('IN');
  });

  it('nothing at all → UNKNOWN', () => {
    expect(geocoder.resolve(undefined).geoPrecision).toBe('UNKNOWN');
    expect(geocoder.resolve({}).geoPrecision).toBe('UNKNOWN');
  });
});

describe('ambiguity is refused, not guessed (R55)', () => {
  it('resolves two same-name cities by population within the state', () => {
    // Kharagpur exists in West Bengal (219k) and in Bihar (31k).
    const bengal = geocoder.resolve({
      city: 'Kharagpur',
      state: 'West Bengal',
      countryCode: 'IN',
    });
    expect(bengal.geoPrecision).toBe('CITY');
    expect(bengal.state).toBe('West Bengal');
    expect(bengal.lat).toBeCloseTo(22.34, 1);
  });

  it('picks the larger when several share a country and differ in population', () => {
    const result = geocoder.resolve({ city: 'Kharagpur', countryCode: 'IN' });
    expect(result.geoPrecision).toBe('CITY');
    // The West Bengal one is an order of magnitude larger.
    expect(result.lat).toBeCloseTo(22.34, 1);
  });

  /**
   * "Hyderabad" is a large city in India and another in Pakistan. R55 forbids
   * guessing across countries whatever the populations say, so with no country
   * stated this must fall back rather than pick India.
   */
  it('never guesses across countries', () => {
    const result = geocoder.resolve({ city: 'Hyderabad' });
    expect(result.geoPrecision).not.toBe('CITY');
    expect(result.geoPrecision).toBe('UNKNOWN');
    expect(result.warnings.map((warning) => warning.code)).toContain('GEO_AMBIGUOUS_PLACE');
  });

  it('but resolves it happily once a country is stated', () => {
    const india = geocoder.resolve({ city: 'Hyderabad', countryCode: 'IN' });
    expect(india.geoPrecision).toBe('CITY');
    expect(india.countryCode).toBe('IN');

    const pakistan = geocoder.resolve({ city: 'Hyderabad', countryCode: 'PK' });
    expect(pakistan.geoPrecision).toBe('CITY');
    expect(pakistan.countryCode).toBe('PK');
    expect(pakistan.lat).not.toBeCloseTo(india.lat ?? 0, 1);
  });

  it('does not widen the search when the stated country has no such city', () => {
    // Seoul is not in India; answering with the Korean one would be a guess.
    const result = geocoder.resolve({ city: 'Seoul', countryCode: 'IN' });
    expect(result.geoPrecision).toBe('COUNTRY');
    expect(result.countryCode).toBe('IN');
  });
});

describe('R55: no network call, ever', () => {
  it('never calls fetch, on any rung', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const place of [
      { lat: 1, lon: 2 },
      { venueName: 'Indian Institute of Technology Bombay' },
      { city: 'Pune', state: 'Maharashtra', countryCode: 'IN' },
      { city: 'Hyderabad' },
      { state: 'Kerala', countryCode: 'IN' },
      { countryCode: 'IN' },
      {},
    ]) {
      geocoder.resolve(place);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('R54: a missing gazetteer degrades, it does not throw', () => {
  it('returns UNKNOWN for a city lookup and still honours the other rungs', () => {
    const degraded = new Geocoder({
      gazetteer: unavailableGazetteer('not built'),
      institutions: loadInstitutions(
        database?.db ??
          (() => {
            throw new Error('no db');
          })(),
      ),
    });

    expect(degraded.resolve({ city: 'Pune', countryCode: 'IN' }).geoPrecision).toBe('COUNTRY');
    expect(degraded.resolve({ city: 'Pune' }).geoPrecision).toBe('UNKNOWN');
    // Source coordinates and the institutions seed do not need the gazetteer.
    expect(degraded.resolve({ lat: 1, lon: 2 }).geoPrecision).toBe('EXACT');
    expect(
      degraded.resolve({ venueName: 'Indian Institute of Technology Bombay' }).geoPrecision,
    ).toBe('INSTITUTION');
  });
});
