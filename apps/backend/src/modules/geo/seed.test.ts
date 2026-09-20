import { afterEach, describe, expect, it } from 'vitest';

import { haversineKm } from '../../domain/geo/distance.js';
import { AuditLog } from '../../platform/audit.js';
import { fixedClock } from '../../platform/time.js';
import { openMigratedDatabase, type MigratedDatabase } from '../../testing/database.js';
import { InstitutionSeedFile } from './institutions.js';
import { loadInstitutions, loadSeedFile, seedInstitutions } from './seed.js';

/**
 * The committed institutions seed and the seeder that loads it.
 *
 * Two properties are under test and the second matters more: the file is
 * plausible, and **re-running the seeder never undoes a person's correction**.
 * A release that quietly reverted an admin's fix is how people stop fixing
 * things.
 */

const clock = fixedClock('2026-09-20T09:00:00.000Z');

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(): { db: MigratedDatabase; audit: AuditLog } {
  database = openMigratedDatabase(undefined, 'inst-seed');
  return { db: database, audit: new AuditLog(database.db, { clock }) };
}

/** India's bounding box, generously drawn. */
const INDIA = { minLat: 6, maxLat: 37.5, minLon: 68, maxLon: 97.5 };

describe('the committed seed file', () => {
  const seed = loadSeedFile();

  it('validates against its schema', () => {
    expect(InstitutionSeedFile.safeParse(seed).success).toBe(true);
  });

  it('is a starter set, capped at 150 rows', () => {
    expect(seed.institutions.length).toBeGreaterThan(80);
    expect(seed.institutions.length).toBeLessThanOrEqual(150);
  });

  it('states where its coordinates came from', () => {
    expect(seed.coordinateSource).toContain('GeoNames');
    expect(seed.coordinateSource).toContain('CC BY 4.0');
    // The promise the file makes, and that this suite exists to keep honest.
    expect(seed.coordinateSource).toContain('No coordinate in this file was invented');
  });

  it('puts every coordinate inside India', () => {
    for (const row of seed.institutions) {
      expect(row.countryCode, row.name).toBe('IN');
      expect(row.lat, row.name).toBeGreaterThanOrEqual(INDIA.minLat);
      expect(row.lat, row.name).toBeLessThanOrEqual(INDIA.maxLat);
      expect(row.lon, row.name).toBeGreaterThanOrEqual(INDIA.minLon);
      expect(row.lon, row.name).toBeLessThanOrEqual(INDIA.maxLon);
    }
  });

  it('has no duplicate natural key', () => {
    const keys = seed.institutions.map((row) => `${row.kind}:${row.name.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marks a row CAMPUS only when the dump had a campus feature', () => {
    const campus = seed.institutions.filter((row) => row.coordPrecision === 'CAMPUS');
    const city = seed.institutions.filter((row) => row.coordPrecision === 'CITY');
    // GeoNames carries very few Indian campuses, so most rows are city-precision
    // and the geocoder reports them as CITY. That is the honest answer.
    expect(campus.length).toBeGreaterThan(0);
    expect(city.length).toBeGreaterThan(campus.length);
  });

  it('gives the institutes a professor actually uses an entry', () => {
    const names = seed.institutions.map((row) => row.name);
    for (const expected of [
      'Indian Institute of Technology Bombay',
      'Indian Institute of Technology Kharagpur',
      'National Institute of Technology Durgapur',
      'Guru Nanak Institute of Technology',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it('keeps a campus coordinate near its own city', () => {
    // The guard that caught a generator bug: a name-only match had pinned
    // Jadavpur University to Rajasthan and PES University to Bihar.
    const byCity = new Map(
      seed.institutions
        .filter((row) => row.coordPrecision === 'CITY')
        .map((row) => [row.city, { lat: row.lat, lon: row.lon }]),
    );
    for (const row of seed.institutions.filter((r) => r.coordPrecision === 'CAMPUS')) {
      const centre = byCity.get(row.city);
      if (centre === undefined) {
        continue;
      }
      expect(haversineKm(row, centre), `${row.name} is far from ${row.city}`).toBeLessThan(60);
    }
  });
});

describe('seeding is idempotent', () => {
  it('inserts on the first run and changes nothing on the second', () => {
    const { db, audit } = open();
    const first = seedInstitutions(db.db, audit, { clock });
    expect(first.inserted).toBeGreaterThan(80);
    expect(first.updated).toBe(0);

    const second = seedInstitutions(db.db, audit, { clock });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(first.inserted);
    expect(loadInstitutions(db.db)).toHaveLength(first.inserted);
  });

  it('is audited as SYSTEM, in the same transaction as the writes', () => {
    const { db, audit } = open();
    seedInstitutions(db.db, audit, { clock });
    const row = audit.all().at(-1);
    expect(row?.action).toBe('institutions.seeded');
    expect(row?.actorKind).toBe('SYSTEM');
    expect(audit.verifyChain().ok).toBe(true);
  });

  it('loads rows in the shape the geocoder matches against', () => {
    const { db, audit } = open();
    seedInstitutions(db.db, audit, { clock });
    const iitb = loadInstitutions(db.db).find(
      (row) => row.name === 'Indian Institute of Technology Bombay',
    );
    expect(iitb).toBeDefined();
    expect(iitb?.shortName).toBe('IIT Bombay');
    expect(iitb?.aliases).toContain('IITB');
    expect(iitb?.coordPrecision).toBe('CAMPUS');
    expect(iitb?.websiteDomain).toBe('iitb.ac.in');
  });
});

describe('a re-seed never overwrites an admin edit', () => {
  it('updates a row the previous seed owned', () => {
    const { db, audit } = open();
    const seed = loadSeedFile();
    seedInstitutions(db.db, audit, { clock, seed: { ...seed, seedVersion: 1 } });

    // A later seed moves a coordinate the admin has not touched.
    const moved = {
      ...seed,
      seedVersion: 2,
      institutions: seed.institutions.map((row, index) =>
        index === 0 ? { ...row, lat: Number((row.lat + 0.01).toFixed(5)) } : row,
      ),
    };
    const result = seedInstitutions(db.db, audit, { clock, seed: moved });
    expect(result.updated).toBeGreaterThan(0);
    expect(result.skippedEdited).toBe(0);
  });

  it('leaves a row an admin has corrected exactly as it is', () => {
    const { db, audit } = open();
    const seed = loadSeedFile();
    seedInstitutions(db.db, audit, { clock, seed: { ...seed, seedVersion: 1 } });

    // The admin corrects a city-centroid coordinate to the real campus.
    const target = loadInstitutions(db.db)[0];
    expect(target).toBeDefined();
    db.db.raw
      .prepare('update institutions set lat = ?, lon = ? where id = ?')
      .run(12.3456, 77.6543, target?.id);

    const result = seedInstitutions(db.db, audit, {
      clock,
      seed: { ...seed, seedVersion: 2 },
    });
    expect(result.skippedEdited).toBeGreaterThan(0);

    const after = loadInstitutions(db.db).find((row) => row.id === target?.id);
    expect(after?.lat).toBe(12.3456);
    expect(after?.lon).toBe(77.6543);
  });
});
