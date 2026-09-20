import type { CandidatePlace, GeoPrecision, ParseWarning } from '@compintel/contracts';

import { bestMatch, type Nameable } from '../../domain/geo/match.js';
import { nameKey } from '../../domain/geo/normalize-name.js';
import type { Gazetteer, GazetteerPlace } from '../../platform/gazetteer.js';
import type { InstitutionRecord } from './institutions.js';

/**
 * Turning what a source said about a place into coordinates (§4.17, ADR-0012,
 * ruling R55).
 *
 * **Lookup and matching only. There is no network call here, ever.** Nominatim
 * stays unbuilt and off (§4.17): this runs during a scrape of hundreds of
 * events, offline, on a professor's laptop, and a geocoder that needed the
 * internet would make the whole pipeline depend on someone else's rate limit.
 *
 * The ladder, in order, each rung setting `geo_precision`:
 *
 * | Rung | Precision | When |
 * |---|---|---|
 * | Source coordinates | `EXACT` | the source gave lat/lon itself |
 * | Institution match | `INSTITUTION` | the venue names a seeded campus |
 * | City + state | `CITY` | both given, and they agree |
 * | City alone | `CITY` | unambiguous, or resolvable by population |
 * | State alone | `STATE` | a state or province name matched |
 * | Country alone | `COUNTRY` | only a country was stated |
 * | — | `UNKNOWN` | nothing usable, or genuinely ambiguous |
 *
 * The last row is the important one. R55 forbids guessing across countries, and
 * a tie that population cannot settle **drops a rung** rather than picking one.
 * A wrong pin puts an event 1200 km from where a professor is looking and
 * nothing downstream ever notices; an `UNKNOWN` is visible, flagged and
 * correctable.
 */

export interface GeocodeResult {
  readonly lat?: number | undefined;
  readonly lon?: number | undefined;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly countryCode?: string | undefined;
  readonly institutionId?: string | undefined;
  readonly geoPrecision: GeoPrecision;
  readonly warnings: readonly ParseWarning[];
}

export interface GeocoderDependencies {
  readonly gazetteer: Gazetteer;
  /** The seeded campuses, loaded once (WP-08b's `institutions` table). */
  readonly institutions: readonly InstitutionRecord[];
}

/** An institution as the matcher sees it. */
interface MatchableInstitution extends Nameable {
  readonly record: InstitutionRecord;
}

export class Geocoder {
  readonly #gazetteer: Gazetteer;
  readonly #institutions: MatchableInstitution[];

  constructor(dependencies: GeocoderDependencies) {
    this.#gazetteer = dependencies.gazetteer;
    this.#institutions = dependencies.institutions.map((record) => ({
      id: record.id,
      name: record.name,
      aliases: [...(record.shortName === undefined ? [] : [record.shortName]), ...record.aliases],
      record,
    }));
  }

  /** Resolves a candidate's stated place. Never throws; never calls out. */
  resolve(place: CandidatePlace | undefined): GeocodeResult {
    const warnings: ParseWarning[] = [];
    if (place === undefined) {
      return { geoPrecision: 'UNKNOWN', warnings };
    }

    // Rung 1 — the source gave coordinates. Nothing beats being told.
    if (place.lat !== undefined && place.lon !== undefined) {
      return {
        lat: place.lat,
        lon: place.lon,
        city: place.city,
        state: place.state,
        countryCode: place.countryCode,
        // A source that also told us how precise its own coordinates are is
        // believed; otherwise coordinates from a source mean a venue.
        geoPrecision: place.geoPrecision ?? 'EXACT',
        warnings,
      };
    }

    // Rung 2 — the venue names an institution we have seeded.
    const institution = this.#matchInstitution(place.venueName);
    if (institution !== undefined) {
      const { record } = institution;
      // R55: a seed row whose coordinates are a city centroid is not a campus,
      // and saying INSTITUTION would overstate what we know.
      const precision: GeoPrecision = record.coordPrecision === 'CAMPUS' ? 'INSTITUTION' : 'CITY';
      return {
        ...(record.lat === undefined ? {} : { lat: record.lat }),
        ...(record.lon === undefined ? {} : { lon: record.lon }),
        city: record.city ?? place.city,
        state: record.state ?? place.state,
        countryCode: record.countryCode ?? place.countryCode,
        institutionId: record.id,
        geoPrecision: record.lat === undefined ? 'UNKNOWN' : precision,
        warnings,
      };
    }

    // Rungs 3 and 4 — a city, narrowed by state or country where we have one.
    if (place.city !== undefined) {
      const resolved = this.#resolveCity(place, warnings);
      if (resolved !== undefined) {
        return resolved;
      }
    }

    // Rung 5 — a state or province on its own.
    if (place.state !== undefined) {
      const admin1 = this.#gazetteer.findAdmin1ByNameKey(nameKey(place.state), place.countryCode);
      const only = admin1.length === 1 ? admin1[0] : undefined;
      if (only !== undefined) {
        return {
          state: only.name,
          countryCode: only.countryCode,
          ...(place.city === undefined ? {} : { city: place.city }),
          geoPrecision: 'STATE',
          warnings,
        };
      }
    }

    // Rung 6 — a country, which at least decides the geography policy.
    if (place.countryCode !== undefined) {
      return {
        countryCode: place.countryCode,
        ...(place.city === undefined ? {} : { city: place.city }),
        ...(place.state === undefined ? {} : { state: place.state }),
        geoPrecision: 'COUNTRY',
        warnings,
      };
    }

    return { geoPrecision: 'UNKNOWN', warnings };
  }

  #matchInstitution(venueName: string | undefined): MatchableInstitution | undefined {
    if (venueName === undefined || this.#institutions.length === 0) {
      return undefined;
    }
    return bestMatch(venueName, this.#institutions)?.item;
  }

  /**
   * A city name, narrowed as far as the record allows.
   *
   * The narrowing is what makes this safe. "Hyderabad" matches a city in India
   * and one in Pakistan; with a country it is one of them, and without one R55
   * says do not choose — so this falls through to the state or country rung
   * rather than picking the bigger.
   */
  #resolveCity(place: CandidatePlace, warnings: ParseWarning[]): GeocodeResult | undefined {
    const key = nameKey(place.city ?? '');
    if (key.length === 0) {
      return undefined;
    }

    let candidates = this.#gazetteer.findByNameKey(key, place.countryCode);
    if (candidates.length === 0 && place.countryCode !== undefined) {
      // The country the source stated has no such city. Do not widen the search
      // — that is exactly how an event ends up in the wrong hemisphere.
      return undefined;
    }
    if (candidates.length === 0) {
      candidates = this.#gazetteer.findByNameKey(key);
    }
    if (candidates.length === 0) {
      return undefined;
    }

    // Narrow by the stated state before considering population.
    if (place.state !== undefined) {
      const within = this.#withinState(candidates, place.state, place.countryCode);
      if (within.length > 0) {
        candidates = within;
      }
    }

    const chosen = this.#chooseCity(candidates, place, warnings);
    if (chosen === undefined) {
      return undefined;
    }
    return {
      lat: chosen.lat,
      lon: chosen.lon,
      city: chosen.name,
      state: this.#gazetteer.admin1(chosen.countryCode, chosen.admin1Code)?.name ?? place.state,
      countryCode: chosen.countryCode,
      geoPrecision: 'CITY',
      warnings,
    };
  }

  #withinState(
    candidates: readonly GazetteerPlace[],
    state: string,
    countryCode: string | undefined,
  ): GazetteerPlace[] {
    const stateKey = nameKey(state);
    const admin1 = this.#gazetteer.findAdmin1ByNameKey(stateKey, countryCode);
    const codes = new Set(admin1.map((row) => `${row.countryCode}.${row.admin1Code}`));
    return candidates.filter((candidate) =>
      codes.has(`${candidate.countryCode}.${candidate.admin1Code}`),
    );
  }

  /**
   * R55's tie-break: the highest-population match **within the already-resolved
   * state or country**, and nothing at all when that is still ambiguous.
   */
  #chooseCity(
    candidates: readonly GazetteerPlace[],
    place: CandidatePlace,
    warnings: ParseWarning[],
  ): GazetteerPlace | undefined {
    if (candidates.length === 1) {
      return candidates[0];
    }

    const countries = new Set(candidates.map((candidate) => candidate.countryCode));
    if (countries.size > 1) {
      // Never across countries (R55), whatever the populations say.
      warnings.push({
        code: 'GEO_AMBIGUOUS_PLACE',
        field: 'place.city',
        message:
          `"${place.city ?? ''}" exists in ${String(countries.size)} countries and the source named none; ` +
          'the location was left less precise rather than guessed.',
      });
      return undefined;
    }

    const ranked = [...candidates].sort((a, b) => b.population - a.population);
    const first = ranked[0];
    const second = ranked[1];
    if (first === undefined) {
      return undefined;
    }
    if (second?.population === first.population) {
      // Two places of equal (often zero) population: the gazetteer carries every
      // hamlet, so this is common and must not be resolved by row order.
      warnings.push({
        code: 'GEO_AMBIGUOUS_PLACE',
        field: 'place.city',
        message:
          `"${place.city ?? ''}" matched ${String(candidates.length)} places with no population to tell them apart; ` +
          'the location was left less precise rather than guessed.',
      });
      return undefined;
    }
    return first;
  }
}
