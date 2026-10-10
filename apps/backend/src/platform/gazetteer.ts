import { existsSync } from 'node:fs';

import Sqlite, { type Database as SqliteDatabase } from 'better-sqlite3';
import type { Logger } from 'pino';

import type { ShutdownRegistry } from './shutdown.js';

/**
 * The shipped, read-only gazetteer (§4.17, ADR-0012, rulings R53 and R54).
 *
 * Two things make this different from `platform/db.ts`. It is **read-only** — it
 * is reference data built by `pnpm gazetteer:build`, never written at runtime
 * and never backed up (§6.2) — and its **absence is not fatal** (R54).
 *
 * That second point is the whole design. A developer on a fresh clone has not
 * built it; `pnpm verify` must still pass. A packaged install might ship without
 * it, or a file might be corrupt. In every one of those cases the right answer
 * is one warning at startup and a geocoder that returns `UNKNOWN` precision —
 * because an event with an unresolved location is still an event worth showing,
 * and refusing to start would turn a missing nicety into an outage.
 */

export const GAZETTEER_FILE = 'gazetteer.db';

/** The schema version `tools/gazetteer` writes; a mismatch is a stale file. */
export const EXPECTED_SCHEMA_VERSION = 1;

export interface GazetteerPlace {
  readonly geonameid: number;
  readonly name: string;
  readonly asciiName: string;
  readonly nameKey: string;
  readonly admin1Code: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
  readonly population: number;
  readonly featureCode: string;
}

export interface GazetteerAdmin1 {
  readonly countryCode: string;
  readonly admin1Code: string;
  readonly name: string;
  readonly nameKey: string;
}

/**
 * What the geocoder needs. An interface rather than a class so the "we have no
 * gazetteer" case is a value, not an exception the caller has to remember.
 */
export interface Gazetteer {
  /** False when no usable file was found; every lookup then returns nothing. */
  readonly available: boolean;
  /** Why it is unavailable, for the startup log and the diagnostics screen. */
  readonly unavailableReason?: string;
  /** Places whose normalized name or an alias matches, optionally within a country. */
  findByNameKey(nameKey: string, countryCode?: string): readonly GazetteerPlace[];
  /** States and provinces whose normalized name matches. */
  findAdmin1ByNameKey(nameKey: string, countryCode?: string): readonly GazetteerAdmin1[];
  /** One state or province by its code, e.g. `IN` + `16`. */
  admin1(countryCode: string, admin1Code: string): GazetteerAdmin1 | undefined;
  /**
   * WP-34's location picker: places whose name starts with the typed text,
   * most populous first. Optional so a fake need not implement it.
   */
  suggest?(typed: string, limit: number): readonly GazetteerPlace[];
  close(): void;
}

/** Lower-cased, with LIKE's own wildcards escaped (escape character `!`). */
export function likePrefix(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[!%_]/g, (char) => `!${char}`);
}

/** The answer when there is no gazetteer: honest, and never throws. */
export function unavailableGazetteer(reason: string): Gazetteer {
  return {
    available: false,
    unavailableReason: reason,
    findByNameKey: () => [],
    findAdmin1ByNameKey: () => [],
    admin1: () => undefined,
    close: () => undefined,
  };
}

export interface OpenGazetteerOptions {
  readonly logger: Logger;
  /** Explicit path; otherwise the A20 resources location next to the entry point. */
  readonly file?: string | undefined;
  /** Closed in the `resources` phase, like every other handle (R14). */
  readonly shutdown?: ShutdownRegistry | undefined;
  readonly nativeBinding?: string | undefined;
}

/**
 * Opens the gazetteer read-only, or returns an unavailable one with the reason.
 *
 * `fileMustExist` matters: without it better-sqlite3 would happily create an
 * empty database, and every lookup would then silently return nothing while
 * looking perfectly healthy.
 */
export function openGazetteer(file: string, options: OpenGazetteerOptions): Gazetteer {
  if (!existsSync(file)) {
    const reason = `no gazetteer at ${file}; build it with \`pnpm gazetteer:build\``;
    options.logger.warn({ file }, `gazetteer unavailable — ${reason}`);
    return unavailableGazetteer(reason);
  }

  let raw: SqliteDatabase;
  try {
    raw = new Sqlite(file, {
      readonly: true,
      fileMustExist: true,
      ...(options.nativeBinding === undefined ? {} : { nativeBinding: options.nativeBinding }),
    });
    const version = (
      raw.prepare("select value from gazetteer_meta where key = 'schema_version'").get() as
        { value: string } | undefined
    )?.value;
    if (Number(version) !== EXPECTED_SCHEMA_VERSION) {
      raw.close();
      const reason = `gazetteer schema version ${String(version)} is not ${String(EXPECTED_SCHEMA_VERSION)}; rebuild it`;
      options.logger.warn({ file }, `gazetteer unavailable — ${reason}`);
      return unavailableGazetteer(reason);
    }
  } catch (cause) {
    const reason = `gazetteer at ${file} could not be opened: ${cause instanceof Error ? cause.message : String(cause)}`;
    options.logger.warn({ file, err: cause }, 'gazetteer unavailable');
    return unavailableGazetteer(reason);
  }

  const byNameKey = raw.prepare(
    `select p.* from places p
      where p.name_key = ?
      union
     select p.* from places p
       join place_alt_names a on a.place_id = p.geonameid
      where a.name_key = ?`,
  );
  const byNameKeyInCountry = raw.prepare(
    `select p.* from places p
      where p.name_key = ? and p.country_code = ?
      union
     select p.* from places p
       join place_alt_names a on a.place_id = p.geonameid
      where a.name_key = ? and p.country_code = ?`,
  );
  const admin1ByNameKey = raw.prepare('select * from admin1 where name_key = ?');
  const admin1ByNameKeyInCountry = raw.prepare(
    'select * from admin1 where name_key = ? and country_code = ?',
  );
  // Prefix on the plain ASCII name: `name_key` sorts its tokens ("delhi new"),
  // so it cannot answer "starts with". 37 k rows; a scan is a millisecond.
  const byPrefix = raw.prepare(
    `select * from places where lower(ascii_name) like ? escape '!'
      order by population desc limit ?`,
  );
  const admin1ByCode = raw.prepare(
    'select * from admin1 where country_code = ? and admin1_code = ?',
  );

  interface PlaceRow {
    geonameid: number;
    name: string;
    ascii_name: string;
    name_key: string;
    admin1_code: string;
    country_code: string;
    lat: number;
    lon: number;
    population: number;
    feature_code: string;
  }
  interface Admin1Row {
    country_code: string;
    admin1_code: string;
    name: string;
    name_key: string;
  }

  const toPlace = (row: PlaceRow): GazetteerPlace => ({
    geonameid: row.geonameid,
    name: row.name,
    asciiName: row.ascii_name,
    nameKey: row.name_key,
    admin1Code: row.admin1_code,
    countryCode: row.country_code,
    lat: row.lat,
    lon: row.lon,
    population: row.population,
    featureCode: row.feature_code,
  });
  const toAdmin1 = (row: Admin1Row): GazetteerAdmin1 => ({
    countryCode: row.country_code,
    admin1Code: row.admin1_code,
    name: row.name,
    nameKey: row.name_key,
  });

  let closed = false;
  const close = (): void => {
    if (!closed) {
      closed = true;
      raw.close();
    }
  };
  options.shutdown?.register('resources', 'gazetteer', close);
  options.logger.info(
    {
      file,
      places: (raw.prepare('select count(*) as n from places').get() as { n: number }).n,
    },
    'gazetteer opened',
  );

  return {
    available: true,
    suggest: (prefix, limit) =>
      prefix.trim() === ''
        ? []
        : (byPrefix.all(`${likePrefix(prefix)}%`, limit) as PlaceRow[]).map(toPlace),
    findByNameKey: (nameKey, countryCode) =>
      (countryCode === undefined
        ? (byNameKey.all(nameKey, nameKey) as PlaceRow[])
        : (byNameKeyInCountry.all(nameKey, countryCode, nameKey, countryCode) as PlaceRow[])
      ).map(toPlace),
    findAdmin1ByNameKey: (nameKey, countryCode) =>
      (countryCode === undefined
        ? (admin1ByNameKey.all(nameKey) as Admin1Row[])
        : (admin1ByNameKeyInCountry.all(nameKey, countryCode) as Admin1Row[])
      ).map(toAdmin1),
    admin1: (countryCode, admin1Code) => {
      const row = admin1ByCode.get(countryCode, admin1Code) as Admin1Row | undefined;
      return row === undefined ? undefined : toAdmin1(row);
    },
    close,
  };
}
