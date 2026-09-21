import { z } from 'zod';

/**
 * Unstop's `/api/public/*` payloads, as far as the adapter relies on them (R71).
 *
 * **Undocumented and not yet recorded.** This shape is reconstructed from what is
 * publicly known about `/api/public/opportunity/search-result`; WP-13's live
 * capture is owed until the first real professor installation signs in. So the
 * schema is deliberately strict about the few keys the mapper needs and loose
 * about everything else: drift in a needed key is `SCHEMA_CHANGED`, never a
 * silently empty event, and an added key is ignored.
 *
 * People-shaped keys an Unstop payload carries — organiser contacts, registered
 * users — pass through `.loose()` untouched and are never read by the mapper's
 * allowlist (D-29).
 */

const Organisation = z.object({ name: z.string().min(1) }).loose();

const Registration = z
  .object({
    start_regn_dt: z.string().nullable().optional(),
    end_regn_dt: z.string().nullable().optional(),
    min_team_size: z.number().int().min(1).nullable().optional(),
    max_team_size: z.number().int().min(1).nullable().optional(),
  })
  .loose();

const Address = z
  .object({
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    country: z.object({ name: z.string().nullable().optional() }).loose().nullable().optional(),
  })
  .loose();

const Prize = z
  .object({
    rank: z.union([z.string(), z.number()]).nullable().optional(),
    cash: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    others: z.string().nullable().optional(),
  })
  .loose();

const Filter = z
  .object({ name: z.string().min(1), type: z.string().nullable().optional() })
  .loose();

export const UnstopOpportunity = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1),
    /** `hackathons`, `competitions`, … */
    type: z.string().min(1),
    subtype: z.string().nullable().optional(),
    /** Relative, e.g. `hackathons/codestorm-2026-1123456`. Stored, never followed. */
    public_url: z.string().min(1),
    organisation: Organisation.nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    regnRequirements: Registration.nullable().optional(),
    region: z.string().nullable().optional(),
    address_with_country_logo: Address.nullable().optional(),
    isPaid: z.boolean().nullable().optional(),
    prizes: z.array(Prize).nullable().optional(),
    filters: z.array(Filter).nullable().optional(),
  })
  .loose();
export type UnstopOpportunity = z.infer<typeof UnstopOpportunity>;

/** One page of `/api/public/opportunity/search-result`. */
export const UnstopListingPage = z
  .object({
    data: z
      .object({
        current_page: z.number().int().min(1),
        last_page: z.number().int().min(1),
        data: z.array(UnstopOpportunity),
      })
      .loose(),
  })
  .loose();
export type UnstopListingPage = z.infer<typeof UnstopListingPage>;

/** `/api/public/competition/{id}`: the same object plus its description. */
export const UnstopDetail = z
  .object({
    data: z
      .object({
        competition: UnstopOpportunity.extend({
          details: z.string().nullable().optional(),
        }).loose(),
      })
      .loose(),
  })
  .loose();
export type UnstopDetail = z.infer<typeof UnstopDetail>;
