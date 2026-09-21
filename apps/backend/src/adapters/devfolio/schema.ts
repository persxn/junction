import { z } from 'zod';

/**
 * Devfolio's server-rendered page data, as far as the adapter relies on it
 * (`source-feasibility.md` §3.5, recorded in `docs/research/fixtures/devfolio/`).
 *
 * The core keys are **required**; anything else is tolerated (`.loose()`) and
 * never read — `participants_details`, `judges`, `mentors`, `stakings`,
 * `sponsor_tiers` and the social handles pass through zod untouched and are
 * dropped by the mapper's allowlist, which never names them (D-29).
 */

const Settings = z
  .object({
    reg_starts_at: z.string().nullable().optional(),
    reg_ends_at: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
    is_hybrid: z.boolean().nullable().optional(),
    paid: z.boolean().nullable().optional(),
  })
  .loose();

const Theme = z.object({ theme: z.object({ name: z.string() }).loose() }).loose();

/** One hackathon as a listing bucket carries it. */
export const DevfolioHackathon = z
  .object({
    // Any non-empty id: WP-02's capture-time redactor mangled one recorded uuid
    // (a digit run read as a phone number), and a pinned fixture is evidence (R62).
    uuid: z.string().min(1).max(64),
    slug: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    starts_at: z.string().min(1),
    ends_at: z.string().min(1),
    is_online: z.boolean(),
    timezone: z.string().nullable().optional(),
    themes: z.array(Theme).nullable().optional(),
    settings: Settings.nullable().optional(),
  })
  .loose();
export type DevfolioHackathon = z.infer<typeof DevfolioHackathon>;

const Faq = z
  .object({ question: z.string().nullable().optional(), answer: z.string().nullable().optional() })
  .loose();

/** The detail page's `hackathon`: the listing fields plus what only the detail has. */
export const DevfolioDetailHackathon = DevfolioHackathon.extend({
  tagline: z.string().nullable().optional(),
  desc: z.string().nullable().optional(),
  team_min: z.number().int().min(1).nullable().optional(),
  team_max: z.number().int().min(1).nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  faqs: z.array(Faq).nullable().optional(),
}).loose();
export type DevfolioDetailHackathon = z.infer<typeof DevfolioDetailHackathon>;

const PrizeDetail = z
  .object({
    name: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    amount: z.number().nullable().optional(),
    value: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
  })
  .loose();

/** `props.pageProps` of `devfolio.co/hackathons`: all four buckets must exist. */
export const DevfolioListingPage = z
  .object({
    open_hackathons: z.array(DevfolioHackathon),
    upcoming_hackathons: z.array(DevfolioHackathon),
    past_hackathons: z.array(DevfolioHackathon),
    featured_hackathons: z.array(DevfolioHackathon),
  })
  .loose();
export type DevfolioListingPage = z.infer<typeof DevfolioListingPage>;

/** `props.pageProps` of `<slug>.devfolio.co/`. */
export const DevfolioDetailPage = z
  .object({
    hackathon: DevfolioDetailHackathon,
    aggregatePrizeValue: z.number().nullable().optional(),
    aggregatePrizeCurrency: z.string().nullable().optional(),
    prizeDetails: z.array(PrizeDetail).nullable().optional(),
  })
  .loose();
export type DevfolioDetailPage = z.infer<typeof DevfolioDetailPage>;
