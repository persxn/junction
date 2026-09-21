import {
  DISTANCE_BUCKETS_KM,
  EventFilters,
  type EventMode,
  type EventType,
  type IncludeUnknown,
  type RegState,
} from '@compintel/contracts';
import { formatIsoDay } from './format.js';
import { EVENT_TYPE_LABELS, MODE_LABELS, REG_STATE_LABELS } from './labels.js';

/**
 * Chips ↔ `EventQuery`, in one place (§8.1, WP-16a step 2).
 *
 * The screen's filter state *is* an `EventQuery` — the part a person chooses,
 * without paging or sort — held in the router's search state so a saved search
 * can later restore a screen verbatim. Each chip reads its value out of that
 * query and writes it back; nothing else in the UI touches query fields. A chip
 * can only produce what the contract can express, because every write ends in
 * `EventQuery.parse`.
 */

/** What a person chooses: an `EventQuery` without cursor, limit or sort. */
export type FilterQuery = EventFilters;

export type DistanceKm = (typeof DISTANCE_BUCKETS_KM)[number];

export type ChipId =
  | 'eventType'
  | 'category'
  | 'mode'
  | 'distance'
  | 'registration'
  | 'dates'
  | 'teamSize'
  | 'fee'
  | 'prize';

/** The value each chip edits. */
export interface ChipValues {
  eventType: readonly EventType[];
  category: readonly string[];
  mode: readonly EventMode[];
  distance: { readonly km: DistanceKm | undefined; readonly includeUnknown: boolean };
  registration: { readonly states: readonly RegState[]; readonly includeUnknown: boolean };
  dates: { readonly from: string | undefined; readonly to: string | undefined };
  teamSize: { readonly fits: number | undefined; readonly includeUnknown: boolean };
  fee: {
    readonly freeOnly: boolean;
    readonly maxRupees: number | undefined;
    readonly includeUnknown: boolean;
  };
  prize: { readonly minRupees: number | undefined };
}

type UnknownField = keyof IncludeUnknown;

/** Removes empty objects and empty lists, so a cleared chip leaves no trace. */
function tidy(query: FilterQuery): FilterQuery {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      const inner = Object.fromEntries(
        Object.entries(value).filter(
          ([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0),
        ),
      );
      if (Object.keys(inner).length === 0) continue;
      out[key] = inner;
      continue;
    }
    out[key] = value;
  }
  return EventFilters.parse(out);
}

function withUnknown(query: FilterQuery, field: UnknownField, on: boolean): FilterQuery {
  return { ...query, includeUnknown: { ...query.includeUnknown, [field]: on ? true : undefined } };
}

const unknownOf = (query: FilterQuery, field: UnknownField): boolean =>
  query.includeUnknown?.[field] === true;

const rupees = (minor: number): number => Math.round(minor / 100);
const minor = (rupees: number): number => Math.round(rupees * 100);
const inr = (rupees: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);

const list = <T extends string>(
  values: readonly T[],
  labels: Readonly<Record<T, string>>,
): string =>
  values.length <= 2
    ? values.map((value) => labels[value]).join(', ')
    : `${labels[values[0]!]} +${String(values.length - 1)}`;

export function readChip<K extends ChipId>(query: FilterQuery, id: K): ChipValues[K] {
  const values: { [P in ChipId]: () => ChipValues[P] } = {
    eventType: () => query.eventTypes ?? [],
    category: () => query.categories ?? [],
    mode: () => query.modes ?? [],
    distance: () => ({
      km: DISTANCE_BUCKETS_KM.find((km) => km === query.maxDistanceKm),
      includeUnknown: unknownOf(query, 'location'),
    }),
    registration: () => ({
      states: query.registration?.states ?? [],
      includeUnknown: unknownOf(query, 'deadline'),
    }),
    dates: () => ({ from: query.eventDate?.from, to: query.eventDate?.to }),
    teamSize: () => ({ fits: query.teamSizeFits, includeUnknown: unknownOf(query, 'teamSize') }),
    fee: () => ({
      freeOnly: query.freeOnly === true,
      maxRupees: query.feeMax === undefined ? undefined : rupees(query.feeMax.minor),
      includeUnknown: unknownOf(query, 'fee'),
    }),
    prize: () => ({
      minRupees: query.prizeMin === undefined ? undefined : rupees(query.prizeMin.minor),
    }),
  };
  return values[id]();
}

export function writeChip<K extends ChipId>(
  query: FilterQuery,
  id: K,
  value: ChipValues[K],
): FilterQuery {
  const v = value;
  switch (id) {
    case 'eventType':
      return tidy({ ...query, eventTypes: [...(v as ChipValues['eventType'])] });
    case 'category':
      return tidy({ ...query, categories: [...(v as ChipValues['category'])] });
    case 'mode':
      return tidy({ ...query, modes: [...(v as ChipValues['mode'])] });
    case 'distance': {
      const d = v as ChipValues['distance'];
      return tidy(
        withUnknown(
          { ...query, maxDistanceKm: d.km },
          'location',
          d.km !== undefined && d.includeUnknown,
        ),
      );
    }
    case 'registration': {
      const r = v as ChipValues['registration'];
      return tidy(
        withUnknown(
          { ...query, registration: { ...query.registration, states: [...r.states] } },
          'deadline',
          r.states.length > 0 && r.includeUnknown,
        ),
      );
    }
    case 'dates': {
      const d = v as ChipValues['dates'];
      return tidy({ ...query, eventDate: { from: d.from, to: d.to } });
    }
    case 'teamSize': {
      const t = v as ChipValues['teamSize'];
      return tidy(
        withUnknown(
          { ...query, teamSizeFits: t.fits },
          'teamSize',
          t.fits !== undefined && t.includeUnknown,
        ),
      );
    }
    case 'fee': {
      const f = v as ChipValues['fee'];
      const feeMax =
        f.freeOnly || f.maxRupees === undefined
          ? undefined
          : { minor: minor(f.maxRupees), currency: 'INR' };
      // A6: `freeOnly` never matches an unknown fee, so the toggle only rides with a maximum.
      return tidy(
        withUnknown(
          { ...query, freeOnly: f.freeOnly, feeMax },
          'fee',
          feeMax !== undefined && f.includeUnknown,
        ),
      );
    }
    case 'prize': {
      const p = v as ChipValues['prize'];
      return tidy({
        ...query,
        prizeMin:
          p.minRupees === undefined ? undefined : { minor: minor(p.minRupees), currency: 'INR' },
      });
    }
  }
}

/** What the chip says when it is set; `undefined` when it is not. */
export function chipLabel(
  query: FilterQuery,
  id: ChipId,
  categoryNames: ReadonlyMap<string, string>,
): string | undefined {
  switch (id) {
    case 'eventType': {
      const v = readChip(query, 'eventType');
      return v.length === 0 ? undefined : list(v, EVENT_TYPE_LABELS);
    }
    case 'category': {
      const v = readChip(query, 'category');
      if (v.length === 0) return undefined;
      const names = Object.fromEntries(v.map((slug) => [slug, categoryNames.get(slug) ?? slug]));
      return list(v, names);
    }
    case 'mode': {
      const v = readChip(query, 'mode');
      return v.length === 0 ? undefined : list(v, MODE_LABELS);
    }
    case 'distance': {
      const v = readChip(query, 'distance');
      // D-06: a radius is straight-line and applies to in-person events (A6).
      return v.km === undefined ? undefined : `Within ${String(v.km)} km (in person)`;
    }
    case 'registration': {
      const v = readChip(query, 'registration');
      return v.states.length === 0
        ? undefined
        : `Registration: ${list(v.states, REG_STATE_LABELS)}`;
    }
    case 'dates': {
      const v = readChip(query, 'dates');
      if (v.from === undefined && v.to === undefined) return undefined;
      // A7: concrete dates, never "next month".
      if (v.from !== undefined && v.to !== undefined)
        return `Runs ${formatIsoDay(v.from)} – ${formatIsoDay(v.to)}`;
      return v.from === undefined
        ? `Runs until ${formatIsoDay(v.to ?? '')}`
        : `Runs from ${formatIsoDay(v.from)}`;
    }
    case 'teamSize': {
      const v = readChip(query, 'teamSize');
      return v.fits === undefined ? undefined : `Team of ${String(v.fits)} fits`;
    }
    case 'fee': {
      const v = readChip(query, 'fee');
      if (v.freeOnly) return 'Free only';
      return v.maxRupees === undefined ? undefined : `Fee up to ${inr(v.maxRupees)}`;
    }
    case 'prize': {
      const v = readChip(query, 'prize');
      return v.minRupees === undefined ? undefined : `Prize from ${inr(v.minRupees)}`;
    }
  }
}

/** The label a chip shows when nothing is chosen. */
export const CHIP_NAMES: Readonly<Record<ChipId, string>> = {
  eventType: 'Event type',
  category: 'Category',
  mode: 'Mode',
  distance: 'Distance',
  registration: 'Registration',
  dates: 'Dates',
  teamSize: 'Team size',
  fee: 'Fee',
  prize: 'Prize',
};

export const CHIP_ORDER: readonly ChipId[] = [
  'eventType',
  'category',
  'mode',
  'distance',
  'registration',
  'dates',
  'teamSize',
  'fee',
  'prize',
];

/** Clears every chip; free text survives, because it lives in the search box, not a chip. */
export function clearChips(query: FilterQuery): FilterQuery {
  return tidy({ text: query.text });
}

export function hasChips(query: FilterQuery): boolean {
  return Object.keys(tidy({ ...query, text: undefined })).length > 0;
}
