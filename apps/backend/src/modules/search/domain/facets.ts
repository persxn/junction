import {
  DISTANCE_BUCKET_VALUES,
  EVENT_MODES,
  EVENT_TYPES,
  FACET_OTHER_VALUE,
  FACET_VALUES_MAX,
  REG_STATES,
  type EventMode,
  type EventType,
  type FacetValue,
  type Facets,
  type RegState,
} from '@compintel/contracts';

/**
 * Facet counts, assembled (§8.2, WP-15b step 6). Pure: `facets.ts` in the
 * module runs one statement and hands its tallies here.
 *
 * **The counting rule** (the UI's copy depends on it): the count next to a
 * value is the number of results the query would return if that family's
 * filter were exactly that value, every other filter unchanged. Visibility,
 * `excludeHidden` and `watchlistedOnly` apply before anything is counted, so a
 * count never promises a row the list cannot show. Consequences:
 *
 * - distance buckets are cumulative — "Within 100 km" includes "Within 50 km";
 *   ONLINE and unknown-location rows join a bucket exactly as the distance
 *   filter would admit them (A6: `modes` naming ONLINE, `includeUnknown.location`);
 * - an unknown deadline joins every registration-state count when
 *   `includeUnknown.deadline` is set, because the filter would admit it;
 * - every enum value is listed, zero or not; categories list every active
 *   category, top {@link FACET_VALUES_MAX} by count, the rest as one `OTHER`.
 */

export const EVENT_TYPE_LABELS: Readonly<Record<EventType, string>> = {
  HACKATHON: 'Hackathon',
  IDEATHON: 'Ideathon',
  INNOVATION_CHALLENGE: 'Innovation challenge',
  CTF: 'CTF',
  CODING_CONTEST: 'Coding contest',
  OTHER: 'Other',
};

export const MODE_LABELS: Readonly<Record<EventMode, string>> = {
  ONLINE: 'Online',
  OFFLINE: 'In person',
  HYBRID: 'Hybrid',
  UNKNOWN: 'Mode unknown',
};

export const REG_STATE_LABELS: Readonly<Record<RegState, string>> = {
  NOT_OPEN: 'Not open yet',
  OPEN: 'Open',
  CLOSING_SOON: 'Closing soon',
  CLOSED: 'Closed',
  UNKNOWN: 'Deadline unknown',
};

/** One registration-state tally row. */
export interface RegStateTally {
  readonly state: RegState;
  /** Rows in this state that pass the deadline range. */
  readonly known: number;
  /** Of those, rows whose deadline is unknown (NOT_OPEN / UNKNOWN only). */
  readonly knownWithoutDeadline: number;
  /** Rows in this state whose deadline is unknown. */
  readonly withoutDeadline: number;
}

export interface DistanceTally {
  /** Located rows within each radius. */
  readonly within: ReadonlyMap<number, number>;
  readonly online: number;
  /** Not online, and no place precise enough to measure from. */
  readonly unlocated: number;
  readonly all: number;
}

export interface FacetTallies {
  readonly eventType: ReadonlyMap<string, number>;
  readonly mode: ReadonlyMap<string, number>;
  readonly registration: readonly RegStateTally[];
  readonly category: ReadonlyMap<string, number>;
  /** Distinct rows holding a category outside the top 20; only when there are more than 20. */
  readonly categoryOther?: number;
  /** `undefined` when no campus is configured: only "Anywhere" can be offered. */
  readonly distance: DistanceTally | undefined;
  /** For the ANYWHERE bucket without a campus. */
  readonly all: number;
}

export interface FacetOptions {
  readonly includeUnknownDeadline: boolean;
  readonly includeOnline: boolean;
  readonly includeUnknownLocation: boolean;
}

export interface CategoryLabel {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** Active categories by count desc, then their configured order — the top 20 are shown. */
export function rankCategories(
  categories: readonly CategoryLabel[],
  counts: ReadonlyMap<string, number>,
): CategoryLabel[] {
  return categories
    .map((category, order) => ({ category, order, count: counts.get(category.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map((entry) => entry.category);
}

export function assembleFacets(
  tallies: FacetTallies,
  categories: readonly CategoryLabel[],
  options: FacetOptions,
): Facets {
  const enumFamily = <T extends string>(
    values: readonly T[],
    labels: Readonly<Record<T, string>>,
    counts: ReadonlyMap<string, number>,
  ): FacetValue[] =>
    values.map((value) => ({ value, label: labels[value], count: counts.get(value) ?? 0 }));

  const withoutDeadline = tallies.registration.reduce((sum, row) => sum + row.withoutDeadline, 0);
  const registrationState = REG_STATES.map((state): FacetValue => {
    const row = tallies.registration.find((tally) => tally.state === state);
    const known = row?.known ?? 0;
    // The unknown-deadline rows the filter would add, minus the ones already counted.
    const extra = options.includeUnknownDeadline
      ? withoutDeadline - (row?.knownWithoutDeadline ?? 0)
      : 0;
    return { value: state, label: REG_STATE_LABELS[state], count: known + extra };
  });

  const ranked = rankCategories(categories, tallies.category);
  const category: FacetValue[] = ranked.slice(0, FACET_VALUES_MAX).map((entry) => ({
    value: entry.slug,
    label: entry.name,
    count: tallies.category.get(entry.id) ?? 0,
  }));
  if (ranked.length > FACET_VALUES_MAX) {
    category.push({ value: FACET_OTHER_VALUE, label: 'Other', count: tallies.categoryOther ?? 0 });
  }

  const d = tallies.distance;
  const distanceBucket: FacetValue[] =
    d === undefined
      ? [{ value: 'ANYWHERE', label: 'Anywhere', count: tallies.all }]
      : DISTANCE_BUCKET_VALUES.map((value) => {
          if (value === 'ANYWHERE') return { value, label: 'Anywhere', count: d.all };
          const km = Number(value);
          const count =
            (d.within.get(km) ?? 0) +
            (options.includeOnline ? d.online : 0) +
            (options.includeUnknownLocation ? d.unlocated : 0);
          return { value, label: `Within ${value} km`, count };
        });

  return {
    eventType: enumFamily(EVENT_TYPES, EVENT_TYPE_LABELS, tallies.eventType),
    category,
    mode: enumFamily(EVENT_MODES, MODE_LABELS, tallies.mode),
    registrationState,
    distanceBucket,
  };
}
