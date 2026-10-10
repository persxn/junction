import type { PlaceSuggestion } from '@compintel/contracts';

import type { DatabaseHandle } from '../../platform/db.js';
import { likePrefix, type Gazetteer } from '../../platform/gazetteer.js';

/**
 * The first-run wizard's location picker (WP-34): "where are you?" answered from
 * what the app already has offline — the institutions list (its campuses) and
 * the gazetteer's cities. Nothing is looked up online (§4.17).
 */

/** At most this many answers; the picker is a short list, not a search page. */
export const MAX_PLACES = 8;
const MAX_INSTITUTIONS = 4;

export class PlacesService {
  readonly #db: DatabaseHandle;
  readonly #gazetteer: Gazetteer;

  constructor(db: DatabaseHandle, gazetteer: Gazetteer) {
    this.#db = db;
    this.#gazetteer = gazetteer;
  }

  /** Institutions first (they carry a campus), then cities; nothing for blank text. */
  suggest(typed: string): readonly PlaceSuggestion[] {
    const text = typed.trim();
    if (text.length < 2) {
      return [];
    }
    const pattern = `${likePrefix(text)}%`;
    const institutions = (
      this.#db.raw
        .prepare(
          `SELECT name, city, lat, lon FROM institutions
            WHERE lat IS NOT NULL AND lon IS NOT NULL
              AND (lower(name) LIKE ? ESCAPE '!' OR lower(coalesce(short_name, '')) LIKE ? ESCAPE '!')
            ORDER BY name LIMIT ?`,
        )
        .all(pattern, pattern, MAX_INSTITUTIONS) as {
        name: string;
        city: string | null;
        lat: number;
        lon: number;
      }[]
    ).map((row): PlaceSuggestion => ({
      label: row.city === null ? row.name : `${row.name}, ${row.city}`,
      kind: 'INSTITUTION',
      lat: row.lat,
      lon: row.lon,
      precision: 'CAMPUS',
    }));
    const cities = (this.#gazetteer.suggest?.(text, MAX_PLACES) ?? []).map(
      (place): PlaceSuggestion => {
        const region = this.#gazetteer.admin1(place.countryCode, place.admin1Code)?.name;
        const parts = [
          place.name,
          region,
          place.countryCode === 'IN' ? undefined : place.countryCode,
        ];
        return {
          label: parts.filter((part) => part !== undefined && part !== '').join(', '),
          kind: 'CITY',
          lat: place.lat,
          lon: place.lon,
          precision: 'CITY',
        };
      },
    );
    return [...institutions, ...cities].slice(0, MAX_PLACES);
  }
}
