import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { boundingBox, haversineKm, withinBoundingBox } from '../domain/geo/distance.js';
import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Ruling R56: **one haversine.**
 *
 * `platform/db.ts` registers the SQL function by delegating to
 * `domain/geo/distance.ts`, so the two cannot drift. This suite is what proves
 * the wiring actually happened — if someone reimplements the formula in SQL for
 * speed, the generated table below stops agreeing and says so.
 */

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(): MigratedDatabase {
  database = openMigratedDatabase(undefined, 'haversine');
  return database;
}

const KOLKATA = { lat: 22.5726, lon: 88.3639 };

describe('haversine_km is registered on every connection', () => {
  it('answers a query', () => {
    const h = open();
    const row = h.db.raw
      .prepare('select haversine_km(?, ?, ?, ?) as km')
      .get(22.5726, 88.3639, 28.6139, 77.209) as { km: number };
    expect(row.km).toBeCloseTo(1305, -1);
  });

  it('agrees with the domain function to 1e-9 over a generated table', () => {
    const h = open();
    const statement = h.db.raw.prepare('select haversine_km(?, ?, ?, ?) as km');

    fc.assert(
      fc.property(
        fc.record({
          lat: fc.double({ min: -89.9, max: 89.9, noNaN: true }),
          lon: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        fc.record({
          lat: fc.double({ min: -89.9, max: 89.9, noNaN: true }),
          lon: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        (a, b) => {
          const sql = (statement.get(a.lat, a.lon, b.lat, b.lon) as { km: number }).km;
          expect(Math.abs(sql - haversineKm(a, b))).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('returns NULL when any coordinate is NULL, because unknown is not zero', () => {
    const h = open();
    const row = h.db.raw
      .prepare('select haversine_km(?, ?, ?, ?) as km')
      .get(null, 88.3639, 28.6139, 77.209) as { km: number | null };
    expect(row.km).toBeNull();
  });

  it('works inside the §8.2 shape: a bounding-box prefilter then exact distance', () => {
    const h = open();
    h.db.raw.exec('create temp table points (id integer primary key, lat real, lon real)');
    const insert = h.db.raw.prepare('insert into points (lat, lon) values (?, ?)');

    // A ring of points at known distances from Kolkata.
    const sample = [
      { lat: 22.5726, lon: 88.3639 }, // 0 km
      { lat: 22.9868, lon: 88.4337 }, // ~46 km
      { lat: 23.5204, lon: 87.3119 }, // ~155 km (Durgapur)
      { lat: 28.6139, lon: 77.209 }, // ~1305 km (Delhi)
      { lat: 19.076, lon: 72.8777 }, // ~1655 km (Mumbai)
    ];
    for (const point of sample) {
      insert.run(point.lat, point.lon);
    }

    const radiusKm = 200;
    const box = boundingBox(KOLKATA, radiusKm);
    const rows = h.db.raw
      .prepare(
        `select lat, lon, haversine_km(?, ?, lat, lon) as km
           from points
          where lat between ? and ?
            and lon between ? and ?
            and haversine_km(?, ?, lat, lon) <= ?
          order by km`,
      )
      .all(
        KOLKATA.lat,
        KOLKATA.lon,
        box.minLat,
        box.maxLat,
        box.minLon,
        box.maxLon,
        KOLKATA.lat,
        KOLKATA.lon,
        radiusKm,
      ) as { lat: number; lon: number; km: number }[];

    // Three of the five are inside 200 km, and the SQL agrees with the domain.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.km).toBeCloseTo(haversineKm(KOLKATA, row), 9);
      expect(withinBoundingBox(box, row)).toBe(true);
    }
    expect(rows[0]?.km).toBe(0);
  });

  it('the prefilter never drops a row the exact distance would have kept', () => {
    const h = open();
    h.db.raw.exec('create temp table wide (lat real, lon real)');
    const insert = h.db.raw.prepare('insert into wide (lat, lon) values (?, ?)');
    for (let lat = -80; lat <= 80; lat += 10) {
      for (let lon = -180; lon <= 180; lon += 15) {
        insert.run(lat, lon);
      }
    }

    for (const radiusKm of [50, 250, 1000]) {
      const box = boundingBox(KOLKATA, radiusKm);
      const insideExact = h.db.raw
        .prepare('select lat, lon from wide where haversine_km(?, ?, lat, lon) <= ?')
        .all(KOLKATA.lat, KOLKATA.lon, radiusKm) as { lat: number; lon: number }[];
      for (const point of insideExact) {
        expect(
          withinBoundingBox(box, point),
          `${String(radiusKm)} km: ${JSON.stringify(point)}`,
        ).toBe(true);
      }
    }
  });
});
