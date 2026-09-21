import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Geocoder } from '../modules/geo/geocoder.js';
import { loadInstitutions, seedInstitutions } from '../modules/geo/seed.js';
import { AuditLog } from '../platform/audit.js';
import { fixedClock, type Clock } from '../platform/time.js';
import { openMigratedDatabase } from './database.js';
import { openMiniGazetteer } from './gazetteer.js';
import { fixturesDir } from './golden.js';

/**
 * Fixtures and a geocoder for the CTFtime adapter's tests (WP-09b).
 *
 * The clock is the capture date of WP-02's recordings, so "the next 120 days"
 * and §7.3's plausible-year window mean what they meant when the payloads were
 * fetched.
 */

/** 20 Sep 2026, the day `docs/research/fixtures/ctftime/` was recorded. */
export const CTFTIME_CAPTURE_CLOCK: Clock = fixedClock('2026-09-20T00:00:00.000Z');

/** The recorded WP-02 captures (R62) — byte-identical to `docs/research/fixtures/ctftime/`. */
export const RECORDED_CTFTIME_FIXTURES = ['detail-event-3417.json', 'listing-events.json'] as const;

/** Written by hand for paths the recordings cannot reach; no research copy. */
export const HAND_WRITTEN_CTFTIME_FIXTURES = [
  'invalid-dates.json',
  'pii-description.json',
] as const;

export function ctftimeFixturePath(name: string): string {
  return path.join(fixturesDir(), 'ctftime', name);
}

export function ctftimeFixtureBytes(name: string): Buffer {
  return readFileSync(ctftimeFixturePath(name));
}

export function ctftimeFixture(name: string): unknown {
  return JSON.parse(ctftimeFixtureBytes(name).toString('utf8')) as unknown;
}

export interface TestGeo {
  readonly geocoder: Geocoder;
  close(): void;
}

/** WP-08b's geocoder over the committed mini gazetteer and the real institutions seed. */
export function openTestGeo(): TestGeo {
  const database = openMigratedDatabase(undefined, 'ctftime-geo');
  seedInstitutions(database.db, new AuditLog(database.db, { clock: CTFTIME_CAPTURE_CLOCK }), {
    clock: CTFTIME_CAPTURE_CLOCK,
  });
  const gazetteer = openMiniGazetteer();
  const geocoder = new Geocoder({ gazetteer, institutions: loadInstitutions(database.db) });
  return {
    geocoder,
    close: () => {
      gazetteer.close();
      database.close();
    },
  };
}
