import path from 'node:path';

import { pino } from 'pino';

import { openGazetteer, type Gazetteer } from '../platform/gazetteer.js';

/**
 * The committed mini gazetteer (ruling R54).
 *
 * `pnpm verify` must pass on a clean clone with no network and no built
 * gazetteer, so the tests use this 53 KB fixture rather than the 68 MB real
 * one. It is built by the same script — `pnpm gazetteer:build --mini` — from the
 * TSV samples in `resources/gazetteer/samples/`, which are rows copied verbatim
 * out of the GeoNames dumps.
 *
 * It carries the places the tests actually name, including the awkward ones:
 * Hyderabad in both India and Pakistan, and Kharagpur in three Indian states.
 */
export function miniGazetteerFile(): string {
  return path.resolve(import.meta.dirname, '..', '..', 'test', 'fixtures', 'gazetteer', 'mini.db');
}

export function openMiniGazetteer(): Gazetteer {
  return openGazetteer(miniGazetteerFile(), { logger: pino({ enabled: false }) });
}
