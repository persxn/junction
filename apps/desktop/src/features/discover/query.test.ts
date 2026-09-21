import { EventQuery } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { effectiveQuery } from './presets.js';
import {
  CHIP_ORDER,
  chipLabel,
  clearChips,
  hasChips,
  readChip,
  writeChip,
  type ChipId,
  type ChipValues,
  type FilterQuery,
} from './query.js';

const NAMES = new Map([['ai-ml', 'AI/ML']]);

/** One realistic value per chip, and the exact `EventQuery` fragment it must produce. */
const CASES: { [K in ChipId]: { value: ChipValues[K]; query: FilterQuery; label: string } } = {
  eventType: {
    value: ['HACKATHON', 'CTF'],
    query: { eventTypes: ['HACKATHON', 'CTF'] },
    label: 'Hackathon, CTF',
  },
  category: { value: ['ai-ml'], query: { categories: ['ai-ml'] }, label: 'AI/ML' },
  mode: { value: ['OFFLINE'], query: { modes: ['OFFLINE'] }, label: 'In person' },
  distance: {
    value: { km: 250, includeUnknown: true },
    query: { maxDistanceKm: 250, includeUnknown: { location: true } },
    label: 'Within 250 km (in person)',
  },
  registration: {
    value: { states: ['OPEN', 'CLOSING_SOON'], includeUnknown: true },
    query: {
      registration: { states: ['OPEN', 'CLOSING_SOON'] },
      includeUnknown: { deadline: true },
    },
    label: 'Registration: Open, Closing soon',
  },
  dates: {
    value: { from: '2026-10-01', to: '2026-10-31' },
    query: { eventDate: { from: '2026-10-01', to: '2026-10-31' } },
    label: 'Runs 1 Oct 2026 – 31 Oct 2026',
  },
  teamSize: {
    value: { fits: 3, includeUnknown: true },
    query: { teamSizeFits: 3, includeUnknown: { teamSize: true } },
    label: 'Team of 3 fits',
  },
  fee: {
    value: { freeOnly: false, maxRupees: 500, includeUnknown: true },
    query: { feeMax: { minor: 50_000, currency: 'INR' }, includeUnknown: { fee: true } },
    label: 'Fee up to ₹500',
  },
  prize: {
    value: { minRupees: 50_000 },
    query: { prizeMin: { minor: 5_000_000, currency: 'INR' } },
    label: 'Prize from ₹50,000',
  },
};

describe('each chip produces exactly its EventQuery and reads back the same value', () => {
  it.each(CHIP_ORDER)('%s', (id) => {
    const { value, query, label } = CASES[id] as {
      value: ChipValues[ChipId];
      query: FilterQuery;
      label: string;
    };
    const written = writeChip({}, id, value as never);
    expect(written).toEqual(query);
    expect(readChip(written, id)).toEqual(value);
    expect(chipLabel(written, id, NAMES)).toBe(label);
    // Whatever a chip writes, the contract accepts.
    expect(EventQuery.safeParse({ ...written, limit: 25 }).success).toBe(true);
  });

  it('a cleared chip leaves no trace, including its includeUnknown flag', () => {
    const set = writeChip({}, 'distance', { km: 100, includeUnknown: true });
    expect(writeChip(set, 'distance', { km: undefined, includeUnknown: true })).toEqual({});
    const states = writeChip({}, 'registration', { states: ['OPEN'], includeUnknown: true });
    expect(writeChip(states, 'registration', { states: [], includeUnknown: true })).toEqual({});
  });

  it('includeUnknown toggles land on their own field and nowhere else', () => {
    let query: FilterQuery = {};
    query = writeChip(query, 'teamSize', { fits: 2, includeUnknown: true });
    query = writeChip(query, 'fee', { freeOnly: false, maxRupees: 100, includeUnknown: false });
    expect(query.includeUnknown).toEqual({ teamSize: true });
  });

  it('"Free only" never carries an unknown-fee flag (A6)', () => {
    const query = writeChip({}, 'fee', { freeOnly: true, maxRupees: 100, includeUnknown: true });
    expect(query).toEqual({ freeOnly: true });
    expect(chipLabel(query, 'fee', NAMES)).toBe('Free only');
  });

  it('a one-sided date range still shows a concrete date', () => {
    expect(
      chipLabel(writeChip({}, 'dates', { from: '2026-12-05', to: undefined }), 'dates', NAMES),
    ).toBe('Runs from 5 Dec 2026');
  });

  it('many values collapse to "first +n"', () => {
    const query = writeChip({}, 'mode', ['ONLINE', 'OFFLINE', 'HYBRID']);
    expect(chipLabel(query, 'mode', NAMES)).toBe('Online +2');
  });

  it('Clear all keeps the search text; hasChips ignores it', () => {
    const query: FilterQuery = { text: 'ctf', modes: ['ONLINE'] };
    expect(hasChips(query)).toBe(true);
    expect(clearChips(query)).toEqual({ text: 'ctf' });
    expect(hasChips(clearChips(query))).toBe(false);
  });
});

describe('tab presets', () => {
  it('the chip wins over the preset, and hidden events are always excluded', () => {
    const query = effectiveQuery('featured', 'nearby', { maxDistanceKm: 500 }, 25);
    expect(query).toMatchObject({
      maxDistanceKm: 500,
      sort: 'DISTANCE',
      excludeHidden: true,
      limit: 25,
    });
    expect(EventQuery.safeParse(query).success).toBe(true);
  });

  it('every tab and view is a valid EventQuery', () => {
    for (const [tab, view] of [
      ['featured', 'nearby'],
      ['featured', 'closing'],
      ['featured', 'new'],
      ['featured', 'recommended'],
      ['all', 'recommended'],
      ['calendar', 'recommended'],
    ] as const) {
      expect(EventQuery.safeParse(effectiveQuery(tab, view, {}, 25)).success).toBe(true);
    }
    expect(effectiveQuery('calendar', 'recommended', {}, 25)).toMatchObject({
      includeRecurring: true,
      sort: 'START',
    });
    expect(effectiveQuery('featured', 'recommended', {}, 25).sort).toBe('RELEVANCE');
  });
});
