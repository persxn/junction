/**
 * Straight-line distance (§6.4, §8.2, D-06, ruling R56).
 *
 * **The formula lives here and nowhere else.** `platform/db.ts` registers this
 * same function with SQLite as `haversine_km(...)`, so §8.2's bounding-box
 * prefilter, WP-15a's exact distance in SQL and any in-process calculation are
 * literally the same code. Two haversines that disagree by a rounding rule is
 * the kind of bug that shows as "this event is 49 km away in the list and 51 km
 * away on the page", and nobody ever finds it.
 *
 * It is a *straight line*, not a route: D-06 fixes the wording to
 * "~180 km (straight line)" precisely so that nobody reads it as a drive. There
 * is no routing engine in this product and there is not going to be one.
 */

/** Mean Earth radius, IUGG (km). Fixed by R56 so the SQL and JS agree exactly. */
export const EARTH_RADIUS_KM = 6371.0088;

export interface Point {
  readonly lat: number;
  readonly lon: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * The haversine form is used rather than the simpler spherical law of cosines
 * because the latter loses precision for short distances — and short distances
 * are the ones this product cares about most, since "within 50 km of campus" is
 * the filter a professor actually reaches for.
 */
export function haversineKm(a: Point, b: Point): number {
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lon - a.lon);
  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);

  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The four numbers a SQL prefilter needs; the argument order `haversine_km` takes. */
export function haversineKmRaw(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
}

/**
 * How far the box is padded outward, in degrees (~0.1 mm).
 *
 * A point exactly on the circle can land a unit in the last place outside a box
 * computed with the same arithmetic, and a prefilter that drops it loses the
 * event for good — the exact distance that would have kept it never runs. So the
 * box errs outward. A false positive costs one more haversine; a false negative
 * costs an event nobody knows is missing.
 */
const EPSILON_DEGREES = 1e-9;

export interface BoundingBox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
  /** True when the box crosses ±180° and a query must be split in two (§8.2). */
  readonly crossesAntimeridian: boolean;
}

/**
 * A latitude/longitude box that **contains** every point within `radiusKm`.
 *
 * This is §8.2's prefilter: an indexed `lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
 * cuts the candidate set down cheaply, and the exact haversine then runs over
 * what survives. The box is deliberately generous — it must never exclude a
 * point that is genuinely inside the radius, because a false negative here
 * silently loses an event and no later step can recover it. A false positive
 * merely costs one more distance calculation.
 *
 * Near a pole the longitude span stops meaning anything, so the box widens to
 * the whole range rather than pretending otherwise.
 */
export function boundingBox(center: Point, radiusKm: number): BoundingBox {
  const radius = Math.max(0, radiusKm);
  const latitudeDelta = (radius / EARTH_RADIUS_KM) * (180 / Math.PI) + EPSILON_DEGREES;

  const minLat = center.lat - latitudeDelta;
  const maxLat = center.lat + latitudeDelta;

  // Longitude lines converge towards the poles, so a degree of longitude is
  // worth less the further north or south you are. The widest the box needs to
  // be is at whichever of its own edges is closest to the equator.
  const widestLat = Math.min(Math.abs(minLat), Math.abs(maxLat));
  const cosine = Math.cos(toRadians(widestLat));

  if (minLat <= -90 || maxLat >= 90 || cosine <= 1e-12) {
    return {
      minLat: Math.max(-90, minLat),
      maxLat: Math.min(90, maxLat),
      minLon: -180,
      maxLon: 180,
      crossesAntimeridian: false,
    };
  }

  const longitudeDelta = latitudeDelta / cosine + EPSILON_DEGREES;
  if (longitudeDelta >= 180) {
    return {
      minLat: Math.max(-90, minLat),
      maxLat: Math.min(90, maxLat),
      minLon: -180,
      maxLon: 180,
      crossesAntimeridian: false,
    };
  }

  const rawMinLon = center.lon - longitudeDelta;
  const rawMaxLon = center.lon + longitudeDelta;
  return {
    minLat: Math.max(-90, minLat),
    maxLat: Math.min(90, maxLat),
    minLon: wrapLongitude(rawMinLon),
    maxLon: wrapLongitude(rawMaxLon),
    crossesAntimeridian: rawMinLon < -180 || rawMaxLon > 180,
  };
}

/** Folds a longitude back into [-180, 180]. */
function wrapLongitude(lon: number): number {
  if (lon >= -180 && lon <= 180) {
    return lon;
  }
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped;
}

/** True when `point` is inside the box, honouring an antimeridian crossing. */
export function withinBoundingBox(box: BoundingBox, point: Point): boolean {
  if (point.lat < box.minLat || point.lat > box.maxLat) {
    return false;
  }
  if (box.crossesAntimeridian) {
    return point.lon >= box.minLon || point.lon <= box.maxLon;
  }
  return point.lon >= box.minLon && point.lon <= box.maxLon;
}

/**
 * How a distance is written, fixed by D-06: **"~180 km (straight line)"**.
 *
 * The tilde and the parenthetical are both load-bearing. The tilde says the
 * number is approximate — it is computed from a city centroid as often as from a
 * campus — and "(straight line)" stops a professor reading 180 km as a three-hour
 * drive when the road is 240 km. Under a kilometre the number stops being
 * meaningful at all, so it is not shown.
 */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) {
    return 'distance unknown';
  }
  if (km < 1) {
    return '< 1 km (straight line)';
  }
  return `~${String(Math.round(km))} km (straight line)`;
}

/** The smallest D-06 ring that contains `km`, or `undefined` beyond the largest. */
export function distanceBucketKm(km: number, buckets: readonly number[]): number | undefined {
  return [...buckets].sort((a, b) => a - b).find((bucket) => km <= bucket);
}
