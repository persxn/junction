import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { InstitutionKind, Uuid7 } from '@compintel/contracts';
import { eq } from 'drizzle-orm';

import { institutions } from '../../db/schema/index.js';
import { normalizeName } from '../../domain/geo/normalize-name.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import {
  InstitutionSeedFile,
  naturalKey,
  type CoordPrecision,
  type InstitutionRecord,
  type InstitutionSeedFile as SeedFile,
} from './institutions.js';

/**
 * Loading the curated institutions into the database (§6.2 "Places", R55).
 *
 * Two properties matter more than the loading itself.
 *
 * **Idempotent.** Running the seeder twice changes nothing. It matches on a
 * natural key — kind plus the normalized name — rather than on an id, because
 * ids are UUIDv7 and a fresh run would mint new ones, turning every upgrade into
 * a duplicate set of every institution.
 *
 * **It never overwrites a person's work.** A professor who corrects IIT Delhi's
 * coordinates because the seed put a city centroid there has told us something
 * the seed does not know. `seed_version` on the row records which seed it came
 * from; a row whose values no longer match its seed has been edited, and the
 * seeder leaves it alone and says so. The alternative — a release quietly
 * reverting a correction — is the kind of thing that makes people stop
 * correcting anything.
 */

/** The committed seed file, relative to the backend package. */
export function seedFilePath(): string {
  return path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'resources',
    'institutions',
    'seed.json',
  );
}

export function loadSeedFile(file = seedFilePath()): SeedFile {
  return InstitutionSeedFile.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface SeedResult {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Rows an admin has edited; left exactly as they are. */
  readonly skippedEdited: number;
}

export interface SeedOptions {
  readonly clock?: Clock;
  readonly newId?: () => Uuid7;
  /** Overridden in tests; the committed file otherwise. */
  readonly seed?: SeedFile;
}

/**
 * The columns the seed owns. A row whose values still match these came from the
 * seed and may be updated; anything else is a person's edit.
 */
interface SeedOwned {
  readonly name: string;
  readonly shortName: string | null;
  readonly kind: InstitutionKind;
  readonly city: string | null;
  readonly state: string | null;
  readonly countryCode: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly websiteDomain: string | null;
  readonly aliasesJson: string;
}

/**
 * `coord_precision` is not a §6.2 column, so it rides in `aliases_json`
 * alongside the aliases. Adding a column for it would mean a migration that
 * §6.2 does not describe; this keeps the schema as the spec writes it and the
 * information available, and WP-16b can promote it if the admin screen needs it.
 */
interface AliasesPayload {
  readonly aliases: readonly string[];
  readonly coordPrecision: CoordPrecision;
  readonly seedVersion: number;
  /**
   * A digest of the values this row held when the seed wrote it.
   *
   * This is how "has a person edited this row?" is answered. Comparing the
   * stored row against the *new* seed cannot work — a row the seed itself is
   * moving differs from the new values by definition, and an earlier version of
   * this file skipped every legitimate update for exactly that reason. Comparing
   * against what the seed last wrote answers the actual question.
   */
  readonly valuesHash?: string;
}

function payload(
  aliases: readonly string[],
  coordPrecision: CoordPrecision,
  seedVersion: number,
  valuesHash: string,
): string {
  return JSON.stringify({
    aliases,
    coordPrecision,
    seedVersion,
    valuesHash,
  } satisfies AliasesPayload);
}

/** The seed-owned values of a row, as one comparable string. */
function valuesHashOf(row: {
  name: string;
  shortName: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  websiteDomain: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.name,
        row.shortName,
        row.city,
        row.state,
        row.lat,
        row.lon,
        row.websiteDomain,
      ]),
      'utf8',
    )
    .digest('hex')
    .slice(0, 16);
}

function parsePayload(json: string): AliasesPayload {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      // Pre-WP-08b shape: a bare array of aliases.
      return { aliases: parsed as string[], coordPrecision: 'CITY', seedVersion: 0 };
    }
    const record = parsed as Partial<AliasesPayload>;
    return {
      aliases: record.aliases ?? [],
      coordPrecision: record.coordPrecision ?? 'CITY',
      seedVersion: record.seedVersion ?? 0,
      ...(record.valuesHash === undefined ? {} : { valuesHash: record.valuesHash }),
    };
  } catch {
    return { aliases: [], coordPrecision: 'CITY', seedVersion: 0 };
  }
}

/**
 * Upserts the seed. Audited as SYSTEM in one transaction with the writes (R35).
 */
export function seedInstitutions(
  db: DatabaseHandle,
  audit: AuditLog,
  options: SeedOptions = {},
): SeedResult {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? uuid7;
  const seed = options.seed ?? loadSeedFile();
  const at = nowMs(clock);

  return withAudit(
    audit,
    (result: SeedResult) => ({
      actorKind: 'SYSTEM' as const,
      actorUserId: null,
      action: 'institutions.seeded',
      entityKind: 'institution',
      entityId: `seed-v${String(seed.seedVersion)}`,
      summary:
        `Seeded institutions v${String(seed.seedVersion)}: ` +
        `${String(result.inserted)} added, ${String(result.updated)} updated, ` +
        `${String(result.unchanged)} unchanged, ${String(result.skippedEdited)} left as edited`,
      diff: { ...result, seedVersion: seed.seedVersion },
    }),
    (): SeedResult => {
      const existing = db.drizzle.select().from(institutions).all();
      const byKey = new Map(
        existing.map((row) => [naturalKey(row.kind, normalizeName(row.name)), row]),
      );

      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let skippedEdited = 0;

      for (const row of seed.institutions) {
        const key = naturalKey(row.kind, normalizeName(row.name));
        const current = byKey.get(key);
        const owned = {
          name: row.name,
          shortName: row.shortName ?? null,
          city: row.city,
          state: row.state,
          lat: row.lat,
          lon: row.lon,
          websiteDomain: row.websiteDomain ?? null,
        };
        const wanted: SeedOwned = {
          ...owned,
          kind: row.kind,
          countryCode: row.countryCode,
          aliasesJson: payload(
            row.aliases,
            row.coordPrecision,
            seed.seedVersion,
            valuesHashOf(owned),
          ),
        };

        if (current === undefined) {
          db.drizzle
            .insert(institutions)
            .values({ id: newId(), ...wanted, createdAt: at, updatedAt: at })
            .run();
          inserted += 1;
          continue;
        }

        const stored = parsePayload(current.aliasesJson);
        if (stored.seedVersion === seed.seedVersion) {
          unchanged += 1;
          continue;
        }
        // A row that still hashes to what the seed last wrote is ours to
        // update; one that does not has been changed by a person since.
        const edited =
          stored.valuesHash !== undefined && stored.valuesHash !== valuesHashOf(current);
        if (edited) {
          skippedEdited += 1;
          continue;
        }

        db.drizzle
          .update(institutions)
          .set({ ...wanted, updatedAt: at })
          .where(eq(institutions.id, current.id))
          .run();
        updated += 1;
      }

      return { inserted, updated, unchanged, skippedEdited };
    },
  );
}

/** Every institution, in the shape the geocoder matches against. */
export function loadInstitutions(db: DatabaseHandle): InstitutionRecord[] {
  return db.drizzle
    .select()
    .from(institutions)
    .all()
    .map((row) => {
      const stored = parsePayload(row.aliasesJson);
      return {
        id: row.id,
        name: row.name,
        shortName: row.shortName ?? undefined,
        kind: row.kind,
        city: row.city ?? undefined,
        state: row.state ?? undefined,
        countryCode: row.countryCode ?? undefined,
        lat: row.lat ?? undefined,
        lon: row.lon ?? undefined,
        coordPrecision: stored.coordPrecision,
        websiteDomain: row.websiteDomain ?? undefined,
        aliases: stored.aliases,
      };
    });
}
