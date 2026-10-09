import { EventQuery, SavedSearchCreate } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { effectiveQuery, filtersToSave, NEARBY_KM } from '../presets.js';
import {
  CHIP_ORDER,
  filtersOfSaved,
  savedQueryOf,
  writeChip,
  type ChipId,
  type ChipValues,
  type FilterQuery,
} from '../query.js';

/**
 * Chips → save → apply → chips (WP-24): for **every** combination of WP-16a's
 * chip fragments, with and without text, the filters a saved search puts
 * back are the filters it was saved from, and the `EventQuery` they make is
 * identical. The server's view is simulated too: the stored query passes
 * through `SavedSearchCreate` and comes back as an `EventQuery` (with `limit`).
 */

const VALUES: { [K in ChipId]: ChipValues[K] } = {
  eventType: ['HACKATHON', 'CTF'],
  category: ['ai-ml'],
  mode: ['OFFLINE'],
  distance: { km: 250, includeUnknown: true },
  registration: { states: ['OPEN', 'CLOSING_SOON'], includeUnknown: true },
  dates: { from: '2026-10-01', to: '2026-10-31' },
  teamSize: { fits: 3, includeUnknown: true },
  fee: { freeOnly: false, maxRupees: 500, includeUnknown: true },
  prize: { minRupees: 50_000 },
};

function chipsFor(mask: number, text: string | undefined): FilterQuery {
  let filters: FilterQuery = text === undefined ? {} : { text };
  CHIP_ORDER.forEach((id, index) => {
    if ((mask & (1 << index)) !== 0) filters = writeChip(filters, id, VALUES[id] as never);
  });
  return filters;
}

/** What the server stores and returns: create-body parsing, then `EventQuery` on read. */
function throughServer(filters: FilterQuery): EventQuery {
  const body = SavedSearchCreate.parse({ name: 'x', query: savedQueryOf(filters) });
  return EventQuery.parse(JSON.parse(JSON.stringify(body.query)));
}

describe('a saved search restores its chips exactly', () => {
  it('for every combination of the nine chips, with and without text', () => {
    let checked = 0;
    for (let mask = 0; mask < 1 << CHIP_ORDER.length; mask += 1) {
      for (const text of [undefined, 'ai hackathon']) {
        const chips = chipsFor(mask, text);
        const restored = filtersOfSaved(throughServer(filtersToSave('all', 'recommended', chips)));
        expect(restored).toStrictEqual(chips);
        expect(effectiveQuery('all', 'recommended', restored, 25)).toStrictEqual(
          effectiveQuery('all', 'recommended', chips, 25),
        );
        checked += 1;
      }
    }
    expect(checked).toBe(1024);
  });

  it('keeps a tab’s defining filter as a chip: Nearby saves its radius', () => {
    const saved = filtersToSave('featured', 'nearby', {});
    expect(saved).toMatchObject({ maxDistanceKm: NEARBY_KM });
    expect(filtersOfSaved(throughServer(saved))).toStrictEqual({ maxDistanceKm: NEARBY_KM });
  });

  it('stores no cursor, page size or sort', () => {
    const query = savedQueryOf(chipsFor(0b11, 'x'));
    expect(query).not.toHaveProperty('cursor');
    expect(query).not.toHaveProperty('limit');
    expect(query).not.toHaveProperty('sort');
  });
});
