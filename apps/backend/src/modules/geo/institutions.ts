import { INSTITUTION_KINDS, type InstitutionKind } from '@compintel/contracts';
import { z } from 'zod';

/**
 * The curated institutions list (§6.2 "Places", ADR-0012, ruling R55).
 *
 * A gazetteer knows where Mumbai is. It does not know that "IIT Bombay" means a
 * campus in Powai, and a source writing only "Guru Nanak Institute of
 * Technology, Sodepur" has told a professor exactly where the event is while
 * telling a city lookup nothing. That gap is what this list closes.
 *
 * It is a **starter set, not an attempt at completeness** — capped at 150 rows,
 * admin-editable from WP-16b onward. Trying to enumerate every Indian college
 * would be a research project with a stale result; covering the institutes that
 * actually run hackathons, and letting a professor add the rest, is the shape
 * that survives contact with use.
 */

/**
 * Whether a row's coordinates are the campus or the middle of its city.
 *
 * R55 makes this load-bearing: a city-centroid row resolves to `CITY`, not
 * `INSTITUTION`, because claiming campus precision for a point that is five
 * kilometres away would make a distance filter quietly wrong.
 */
export const COORD_PRECISIONS = ['CAMPUS', 'CITY'] as const;
export const CoordPrecision = z.enum(COORD_PRECISIONS);
export type CoordPrecision = z.infer<typeof CoordPrecision>;

/** One row of `resources/institutions/seed.json`. */
export const InstitutionSeedRow = z
  .object({
    name: z.string().min(2),
    shortName: z.string().min(1).optional(),
    kind: z.enum(INSTITUTION_KINDS),
    city: z.string().min(1),
    state: z.string().min(1),
    countryCode: z
      .string()
      .length(2)
      .regex(/^[A-Z]{2}$/),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    coordPrecision: CoordPrecision,
    websiteDomain: z.string().min(3).optional(),
    aliases: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type InstitutionSeedRow = z.infer<typeof InstitutionSeedRow>;

/** The file, with its provenance header. */
export const InstitutionSeedFile = z
  .object({
    /** Bumped when rows change; a re-seed only touches rows it has not seen. */
    seedVersion: z.int().min(1),
    /** Where every coordinate came from — never invented (see the file header). */
    coordinateSource: z.string().min(1),
    note: z.string().min(1),
    institutions: z.array(InstitutionSeedRow).min(1).max(150),
  })
  .strict();
export type InstitutionSeedFile = z.infer<typeof InstitutionSeedFile>;

/** An institution as the geocoder uses it, loaded from the table. */
export interface InstitutionRecord {
  readonly id: string;
  readonly name: string;
  readonly shortName?: string | undefined;
  readonly kind: InstitutionKind;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly countryCode?: string | undefined;
  readonly lat?: number | undefined;
  readonly lon?: number | undefined;
  readonly coordPrecision: CoordPrecision;
  readonly websiteDomain?: string | undefined;
  readonly aliases: readonly string[];
}

/**
 * The natural key a re-seed matches on: kind plus the normalized name.
 *
 * Not the display name, because "IIT Bombay" and "Indian Institute of Technology
 * Bombay" are the same institution and a seed edit that changes the wording must
 * not create a second row. Not the id either — ids are UUIDv7 and a fresh seed
 * run generates new ones.
 */
export function naturalKey(kind: string, normalizedName: string): string {
  return `${kind}:${normalizedName}`;
}
