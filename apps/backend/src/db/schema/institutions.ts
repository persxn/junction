import { INSTITUTION_KINDS, type InstitutionKind } from '@compintel/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** `'A', 'B'` — CHECK lists are written from the contracts enums (§6.1). */
function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * Institutions (§6.2 "Places", ruling R48).
 *
 * The table an event's `host_institution_id` points at: a curated list of
 * colleges and universities with their coordinates, so "IIT Bombay" resolves to
 * a place rather than a string, and "within 100 km of campus" can include an
 * event whose venue is only ever written as an institute's name.
 *
 * It is created here, empty. **WP-08b seeds it** and owns the matching logic;
 * this work package only needs somewhere for the foreign key to point.
 *
 * `aliases_json` is a JSON array of the other names a source might use ("IIT
 * Bombay", "Indian Institute of Technology Bombay", "IITB"). It is a column
 * rather than a table because it is read whole, never queried into, and WP-08b's
 * matcher loads the lot into memory once.
 */
export const institutions = sqliteTable(
  'institutions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    kind: text('kind').$type<InstitutionKind>().notNull().default('OTHER'),
    city: text('city'),
    state: text('state'),
    countryCode: text('country_code'),
    lat: real('lat'),
    lon: real('lon'),
    /** Used to recognise an event URL as belonging to this institution. */
    websiteDomain: text('website_domain'),
    /** JSON array of alternative names; see above. */
    aliasesJson: text('aliases_json').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('institutions_name_idx').on(table.name),
    index('institutions_city_idx').on(table.city),
    index('institutions_website_domain_idx').on(table.websiteDomain),
    check('institutions_kind_check', sql.raw(`"kind" in (${quoted(INSTITUTION_KINDS)})`)),
    check('institutions_lat_check', sql.raw(`"lat" is null or "lat" between -90 and 90`)),
    check('institutions_lon_check', sql.raw(`"lon" is null or "lon" between -180 and 180`)),
    check(
      'institutions_country_code_check',
      sql.raw(
        `"country_code" is null or ("country_code" = upper("country_code") and length("country_code") = 2)`,
      ),
    ),
  ],
);
export type InstitutionRow = typeof institutions.$inferSelect;
