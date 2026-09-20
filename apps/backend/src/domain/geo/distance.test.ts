import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  boundingBox,
  distanceBucketKm,
  EARTH_RADIUS_KM,
  formatDistanceKm,
  haversineKm,
  haversineKmRaw,
  withinBoundingBox,
} from './distance.js';

/**
 * Straight-line distance (§6.4, D-06, ruling R56).
 *
 * The bounding-box property is the one that matters most: §8.2 uses it as an
 * indexed prefilter, so a box that excludes a point inside the radius silently
 * loses an event and no later step can recover it.
 */

const KOLKATA = { lat: 22.5726, lon: 88.3639 };
const DELHI = { lat: 28.6139, lon: 77.209 };
const MUMBAI = { lat: 19.076, lon: 72.8777 };

describe('haversineKm', () => {
  it('matches known distances to within a kilometre', () => {
    expect(haversineKm(KOLKATA, DELHI)).toBeCloseTo(1305, -1);
    expect(haversineKm(MUMBAI, DELHI)).toBeCloseTo(1153, -1);
  });

  it('is zero from a point to itself', () => {
    expect(haversineKm(KOLKATA, KOLKATA)).toBe(0);
  });

  it('gives half the circumference for antipodes', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_KM,
      6,
    );
    expect(haversineKm({ lat: -90, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_KM,
      6,
    );
  });

  it('is symmetric', () => {
    expect(haversineKm(KOLKATA, MUMBAI)).toBeCloseTo(haversineKm(MUMBAI, KOLKATA), 9);
  });

  it('crosses the antimeridian without going the long way round', () => {
    const near = haversineKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 });
    expect(near).toBeLessThan(120);
  });

  it('exposes the same maths in the four-argument form the SQL function uses', () => {
    expect(haversineKmRaw(KOLKATA.lat, KOLKATA.lon, DELHI.lat, DELHI.lon)).toBe(
      haversineKm(KOLKATA, DELHI),
    );
  });
});

describe('formatDistanceKm (D-06)', () => {
  it('is exactly the wording the spec fixes', () => {
    expect(formatDistanceKm(180.4)).toBe('~180 km (straight line)');
    expect(formatDistanceKm(180.6)).toBe('~181 km (straight line)');
  });

  it('says "< 1 km" rather than a meaningless number', () => {
    expect(formatDistanceKm(0)).toBe('< 1 km (straight line)');
    expect(formatDistanceKm(0.4)).toBe('< 1 km (straight line)');
  });

  it('refuses to render a distance it does not have', () => {
    expect(formatDistanceKm(Number.NaN)).toBe('distance unknown');
    expect(formatDistanceKm(-1)).toBe('distance unknown');
  });

  it('always says "straight line", because it is not a drive', () => {
    for (const km of [1, 50, 1305]) {
      expect(formatDistanceKm(km)).toContain('(straight line)');
    }
  });
});

describe('boundingBox (§8.2 prefilter)', () => {
  it('contains the centre', () => {
    expect(withinBoundingBox(boundingBox(KOLKATA, 50), KOLKATA)).toBe(true);
  });

  it('never excludes a point inside the radius', () => {
    fc.assert(
      fc.property(
        fc.record({
          lat: fc.double({ min: -85, max: 85, noNaN: true }),
          lon: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (centre, radiusKm, bearingDegrees, fraction) => {
          // A point at `fraction` of the radius along a bearing — guaranteed
          // inside the circle, so the box must contain it.
          const distance = radiusKm * fraction;
          const bearing = (bearingDegrees * Math.PI) / 180;
          const angular = distance / EARTH_RADIUS_KM;
          const lat1 = (centre.lat * Math.PI) / 180;
          const lon1 = (centre.lon * Math.PI) / 180;
          const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(angular) +
              Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
          );
          const lon2 =
            lon1 +
            Math.atan2(
              Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
              Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
            );
          const point = {
            lat: (lat2 * 180) / Math.PI,
            lon: (((((lon2 * 180) / Math.PI + 180) % 360) + 360) % 360) - 180,
          };
          if (haversineKm(centre, point) > radiusKm + 1e-9) {
            return; // floating point put it just outside; not this test's business
          }
          expect(withinBoundingBox(boundingBox(centre, radiusKm), point)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('widens to the whole world near a pole', () => {
    const box = boundingBox({ lat: 89.5, lon: 0 }, 500);
    expect(box.minLon).toBe(-180);
    expect(box.maxLon).toBe(180);
  });

  it('flags a crossing of the antimeridian so a query can split in two', () => {
    expect(boundingBox({ lat: 0, lon: 179.9 }, 100).crossesAntimeridian).toBe(true);
    expect(boundingBox(KOLKATA, 100).crossesAntimeridian).toBe(false);
  });
});

describe('distanceBucketKm (D-06)', () => {
  it('picks the smallest ring that contains the distance', () => {
    const buckets = [50, 100, 250, 500];
    expect(distanceBucketKm(10, buckets)).toBe(50);
    expect(distanceBucketKm(50, buckets)).toBe(50);
    expect(distanceBucketKm(51, buckets)).toBe(100);
    expect(distanceBucketKm(400, buckets)).toBe(500);
  });

  it('is undefined beyond the largest ring — "Anywhere"', () => {
    expect(distanceBucketKm(5000, [50, 100, 250, 500])).toBeUndefined();
  });
});
