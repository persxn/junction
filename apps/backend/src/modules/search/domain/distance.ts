import { boundingBox, type Point } from '../../../domain/geo/distance.js';

/**
 * §8.2's distance prefilter, shaped for SQL.
 *
 * The box arithmetic is WP-08b's `boundingBox` (R56: one haversine, one box),
 * and it errs outward so a point on the circle is never lost. This file only
 * turns it into what an indexed `lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
 * needs — including the case where the box crosses ±180° and one longitude
 * range becomes two. The exact `haversine_km` test then runs on the survivors.
 */

export interface LonRange {
  readonly min: number;
  readonly max: number;
}

export interface RadiusRanges {
  readonly minLat: number;
  readonly maxLat: number;
  /** One range, or two when the box crosses the antimeridian. */
  readonly lon: readonly LonRange[];
}

export function radiusRanges(center: Point, radiusKm: number): RadiusRanges {
  const box = boundingBox(center, radiusKm);
  const lon = box.crossesAntimeridian
    ? [
        { min: box.minLon, max: 180 },
        { min: -180, max: box.maxLon },
      ]
    : [{ min: box.minLon, max: box.maxLon }];
  return { minLat: box.minLat, maxLat: box.maxLat, lon };
}
