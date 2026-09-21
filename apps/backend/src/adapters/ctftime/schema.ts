import { z } from 'zod';

/**
 * CTFtime's documented event object, as far as this adapter relies on it
 * (`docs/research/source-feasibility.md` §1.5, fixtures under
 * `test/fixtures/ctftime/`).
 *
 * Only the keys the mapping reads are required. A key CTFtime *adds* is
 * tolerated — `.loose()` keeps it on the parsed object and the mapper's
 * allowlist never reads it — because an additive change is not a format change.
 * A key it *removes or retypes* fails here, which is the `SCHEMA_CHANGED` the
 * run records and the reason the source pauses (§7.7).
 */

const Organizer = z
  .object({
    id: z.number().optional(),
    name: z.string(),
  })
  .loose();

const Duration = z
  .object({
    days: z.number().int().min(0),
    hours: z.number().int().min(0),
  })
  .loose();

export const CtftimeEvent = z
  .object({
    id: z.number().int().positive(),
    title: z.string(),
    start: z.string(),
    finish: z.string(),
    duration: Duration,
    organizers: z.array(Organizer),
    onsite: z.boolean(),
    location: z.string(),
    description: z.string(),
    prizes: z.string(),
    restrictions: z.string(),
    url: z.string(),
    ctftime_url: z.string(),
    format: z.string().optional(),
  })
  .loose();
export type CtftimeEvent = z.infer<typeof CtftimeEvent>;

/** `/api/v1/events/` answers a bare array of events. */
export const CtftimeListing = z.array(CtftimeEvent);
