import { z } from 'zod';

/**
 * CLIST's documented v4 contest object and listing page (`clist.by/api/v4/doc/`,
 * `docs/research/source-feasibility.md` §2.5 — from the documentation; CLIST
 * has never been called). Keys CLIST adds are tolerated (`.loose()`); a key it
 * removes or retypes is `SCHEMA_CHANGED`.
 */

export const ClistContest = z
  .object({
    id: z.number().int().positive(),
    event: z.string().min(1),
    /** The platform's host, e.g. `codeforces.com`. */
    resource: z.string().min(1),
    host: z.string().optional(),
    /** ISO date-time; UTC unless a `timezone` parameter is sent (we send none). */
    start: z.string().min(1),
    end: z.string().min(1),
    /** Seconds. */
    duration: z.number().int().min(0),
    href: z.string().min(1),
    n_problems: z.number().int().min(0).nullable().optional(),
  })
  .loose();
export type ClistContest = z.infer<typeof ClistContest>;

export const ClistListing = z
  .object({
    meta: z
      .object({
        limit: z.number().int().min(1),
        offset: z.number().int().min(0),
        total_count: z.number().int().min(0),
      })
      .loose(),
    objects: z.array(ClistContest),
  })
  .loose();
export type ClistListing = z.infer<typeof ClistListing>;
