import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { nameKey } from '@compintel/backend';
import Sqlite from 'better-sqlite3';

import { readEntry } from './zip.js';

/**
 * Builds `gazetteer.db` from GeoNames (§4.17, ADR-0012, ruling R53).
 *
 * **The output is not committed.** R53: anything over 2 MB never is, and a
 * gazetteer is tens of megabytes. What *is* committed is this script, the
 * trimmed TSV samples the `--mini` fixture is built from, `manifest.json` and
 * `ATTRIBUTION.md` — so the build is reproducible from git alone, and a reviewer
 * can see exactly which rows were kept and why.
 *
 * Sources download to `%LOCALAPPDATA%\CompIntel-dev\gazetteer-src` and stay
 * there between runs, because they are ~19 MB and re-downloading them to rebuild
 * is rude to GeoNames and slow for us.
 *
 * Usage:
 *   pnpm gazetteer:build            # the real thing, downloading if needed
 *   pnpm gazetteer:build --mini     # the ≤200 KB test fixture, from the samples
 *   pnpm gazetteer:build --out <p>  # somewhere other than the default
 */

const GEONAMES_BASE = 'https://download.geonames.org/export/dump';

/**
 * What we take, and what we leave.
 *
 * `IN.zip` filtered to **feature class P** — populated places. The full Indian
 * dump is ~150k rows including every stream, ridge and forest block; a product
 * that resolves "Pune, Maharashtra" needs the towns and nothing else.
 * `cities15000.zip` covers the rest of the world at 15 000 inhabitants and up,
 * which is enough to recognise "Seoul" or "Berlin" without carrying the planet.
 */
const SOURCES = [
  {
    file: 'IN.zip',
    entry: 'IN.txt',
    filter: 'FEATURE_CLASS_P' as const,
    note: 'India, populated places only',
  },
  {
    file: 'cities15000.zip',
    entry: 'cities15000.txt',
    filter: 'NONE' as const,
    note: 'World, population >= 15000',
  },
  {
    file: 'admin1CodesASCII.txt',
    entry: 'admin1CodesASCII.txt',
    filter: 'NONE' as const,
    note: 'State and province names',
  },
] as const;

/** The GeoNames columns this build reads, by index (their `readme.txt`). */
const COL = {
  geonameid: 0,
  name: 1,
  asciiname: 2,
  alternatenames: 3,
  latitude: 4,
  longitude: 5,
  featureClass: 6,
  featureCode: 7,
  countryCode: 8,
  admin1Code: 10,
  population: 14,
} as const;

/** `%LOCALAPPDATA%\CompIntel-dev\gazetteer-src` — never inside the repo (R53). */
function sourceDir(): string {
  const localAppData = process.env.LOCALAPPDATA;
  const base =
    localAppData !== undefined && localAppData.length > 0
      ? localAppData
      : path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev', 'gazetteer-src');
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const samplesDir = path.join(repoRoot, 'resources', 'gazetteer', 'samples');
const manifestFile = path.join(repoRoot, 'resources', 'gazetteer', 'manifest.json');

function defaultOut(mini: boolean): string {
  return mini
    ? path.join(repoRoot, 'apps', 'backend', 'test', 'fixtures', 'gazetteer', 'mini.db')
    : path.join(sourceDir(), '..', 'gazetteer', 'gazetteer.db');
}

async function download(file: string): Promise<string> {
  const target = path.join(sourceDir(), file);
  if (existsSync(target) && statSync(target).size > 0) {
    process.stdout.write(`  cached  ${file}\n`);
    return target;
  }
  mkdirSync(sourceDir(), { recursive: true });
  process.stdout.write(`  fetch   ${file} ...\n`);
  const response = await fetch(`${GEONAMES_BASE}/${file}`);
  if (!response.ok) {
    throw new Error(`Could not download ${file}: HTTP ${String(response.status)}`);
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

/** The TSV inside a `.zip`, or the file itself when it is already plain text. */
function readTsv(file: string, entry: string): string {
  if (!file.endsWith('.zip')) {
    return readFileSync(file, 'utf8');
  }
  return readEntry(readFileSync(file), entry).toString('utf8');
}

interface Place {
  readonly geonameid: number;
  readonly name: string;
  readonly asciiName: string;
  readonly altNames: readonly string[];
  readonly lat: number;
  readonly lon: number;
  readonly featureCode: string;
  readonly countryCode: string;
  readonly admin1Code: string;
  readonly population: number;
}

function parsePlaces(tsv: string, filter: 'FEATURE_CLASS_P' | 'NONE'): Place[] {
  const places: Place[] = [];
  for (const line of tsv.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    const cells = line.split('\t');
    if (cells.length < 15) {
      continue;
    }
    if (filter === 'FEATURE_CLASS_P' && cells[COL.featureClass] !== 'P') {
      continue;
    }
    const lat = Number(cells[COL.latitude]);
    const lon = Number(cells[COL.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    places.push({
      geonameid: Number(cells[COL.geonameid]),
      name: cells[COL.name] ?? '',
      asciiName: cells[COL.asciiname] ?? '',
      altNames: (cells[COL.alternatenames] ?? '').split(',').filter((name) => name.length > 0),
      lat,
      lon,
      featureCode: cells[COL.featureCode] ?? '',
      countryCode: cells[COL.countryCode] ?? '',
      admin1Code: cells[COL.admin1Code] ?? '',
      population: Number(cells[COL.population] ?? '0') || 0,
    });
  }
  return places;
}

interface Admin1 {
  readonly countryCode: string;
  readonly admin1Code: string;
  readonly name: string;
}

function parseAdmin1(tsv: string): Admin1[] {
  const rows: Admin1[] = [];
  for (const line of tsv.split('\n')) {
    const cells = line.split('\t');
    const key = cells[0];
    const name = cells[1];
    if (key === undefined || name === undefined) {
      continue;
    }
    const [countryCode, admin1Code] = key.split('.');
    if (countryCode === undefined || admin1Code === undefined) {
      continue;
    }
    rows.push({ countryCode, admin1Code, name });
  }
  return rows;
}

const SCHEMA_VERSION = 1;

function createSchema(db: Sqlite.Database): void {
  db.exec(`
    pragma journal_mode = delete;
    create table places (
      geonameid   integer primary key,
      name        text not null,
      ascii_name  text not null,
      name_key    text not null,
      admin1_code text not null,
      country_code text not null,
      lat         real not null,
      lon         real not null,
      population  integer not null default 0,
      feature_code text not null
    );
    create table place_alt_names (
      place_id integer not null references places(geonameid),
      name_key text not null
    );
    create table admin1 (
      country_code text not null,
      admin1_code  text not null,
      name         text not null,
      name_key     text not null,
      primary key (country_code, admin1_code)
    );
    create table gazetteer_meta (key text primary key, value text not null);
    create index places_country_name_key_idx on places (country_code, name_key);
    create index places_name_key_idx on places (name_key);
    create index place_alt_names_name_key_idx on place_alt_names (name_key);
    create index admin1_name_key_idx on admin1 (name_key);
  `);
}

/**
 * Alternative names worth indexing.
 *
 * GeoNames ships up to a few hundred per place, most of them transliterations
 * into scripts no source in this product will ever use. Ten Latin-script ones is
 * plenty to catch "Bombay" for Mumbai and "Calcutta" for Kolkata, which is the
 * whole point, and it keeps the index small enough to stay fast.
 */
const MAX_ALT_NAMES = 10;
const LATIN_ONLY = /^[\p{Script=Latin}\p{Nd}\s.'()-]+$/u;

function usefulAltNames(place: Place): string[] {
  const keys = new Set<string>();
  const own = nameKey(place.name);
  for (const alt of place.altNames) {
    if (keys.size >= MAX_ALT_NAMES) {
      break;
    }
    if (!LATIN_ONLY.test(alt)) {
      continue;
    }
    const key = nameKey(alt);
    if (key.length === 0 || key === own) {
      continue;
    }
    keys.add(key);
  }
  return [...keys];
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { mini: { type: 'boolean' }, out: { type: 'string' } },
    allowPositionals: false,
    strict: true,
  });
  const mini = values.mini === true;
  const out = values.out ?? defaultOut(mini);

  process.stdout.write(mini ? 'gazetteer:build --mini\n' : 'gazetteer:build\n');

  const inputs: { source: (typeof SOURCES)[number]; tsv: string; file: string }[] = [];
  for (const source of SOURCES) {
    if (mini) {
      // R54: the fixture is built from committed samples, so `pnpm verify` runs
      // on a clean clone with no network.
      const file = path.join(samplesDir, `${source.entry}.sample.tsv`);
      inputs.push({ source, tsv: readFileSync(file, 'utf8'), file });
    } else {
      const file = await download(source.file);
      inputs.push({ source, tsv: readTsv(file, source.entry), file });
    }
  }

  const places = new Map<number, Place>();
  let admin1: Admin1[] = [];
  for (const { source, tsv } of inputs) {
    if (source.entry === 'admin1CodesASCII.txt') {
      admin1 = parseAdmin1(tsv);
      continue;
    }
    for (const place of parsePlaces(tsv, source.filter)) {
      // IN.zip and cities15000.zip overlap on large Indian cities; the first
      // wins, which is the Indian dump, and it is the more detailed of the two.
      if (!places.has(place.geonameid)) {
        places.set(place.geonameid, place);
      }
    }
  }

  mkdirSync(path.dirname(out), { recursive: true });
  if (existsSync(out)) {
    writeFileSync(out, '');
  }
  const db = new Sqlite(out);
  createSchema(db);

  const insertPlace = db.prepare(
    `insert into places (geonameid, name, ascii_name, name_key, admin1_code, country_code, lat, lon, population, feature_code)
     values (@geonameid, @name, @asciiName, @nameKey, @admin1Code, @countryCode, @lat, @lon, @population, @featureCode)`,
  );
  const insertAlt = db.prepare('insert into place_alt_names (place_id, name_key) values (?, ?)');
  const insertAdmin1 = db.prepare(
    'insert or replace into admin1 (country_code, admin1_code, name, name_key) values (?, ?, ?, ?)',
  );
  const insertMeta = db.prepare('insert or replace into gazetteer_meta (key, value) values (?, ?)');

  let altCount = 0;
  db.transaction(() => {
    for (const place of places.values()) {
      insertPlace.run({ ...place, nameKey: nameKey(place.name) });
      for (const key of usefulAltNames(place)) {
        insertAlt.run(place.geonameid, key);
        altCount += 1;
      }
    }
    for (const row of admin1) {
      insertAdmin1.run(row.countryCode, row.admin1Code, row.name, nameKey(row.name));
    }
    insertMeta.run('schema_version', String(SCHEMA_VERSION));
    insertMeta.run('built_at', new Date().toISOString());
    insertMeta.run('place_count', String(places.size));
    insertMeta.run('admin1_count', String(admin1.length));
    insertMeta.run('mini', mini ? '1' : '0');
  })();

  db.exec('vacuum');
  db.close();

  const size = statSync(out).size;
  process.stdout.write(
    `  places  ${String(places.size)}\n` +
      `  aliases ${String(altCount)}\n` +
      `  admin1  ${String(admin1.length)}\n` +
      `  output  ${out} (${(size / 1024 / 1024).toFixed(2)} MB)\n`,
  );

  if (!mini) {
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      builtAt: new Date().toISOString().slice(0, 10),
      license: 'CC BY 4.0 — see resources/gazetteer/ATTRIBUTION.md',
      sources: inputs.map(({ source, file }) => ({
        url: `${GEONAMES_BASE}/${source.file}`,
        entry: source.entry,
        filter: source.filter,
        note: source.note,
        sha256: sha256(file),
        bytes: statSync(file).size,
      })),
      rows: { places: places.size, placeAltNames: altCount, admin1: admin1.length },
      output: { bytes: size },
    };
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`  manifest ${manifestFile}\n`);
  }
}

await main();
