import type { EventCandidate } from '@compintel/contracts';
import { z } from 'zod';

import { AdapterFormatError } from '../../scraping/errors.js';
import { ScrapeRequestError, type PoliteResponse } from '../../scraping/http/index.js';
import type {
  AdapterContext,
  ListingItem,
  ListingWalk,
  NormalizeContext,
  RawDetail,
  SourceAdapter,
} from '../../sources/types.js';
import { DevfolioFormatError, extractDetail, extractListing, loadHtmlParser } from './extract.js';
import { DEVFOLIO_ORIGIN, fetchPage, hackathonUrl, slugOf } from './fetch.js';
import { devfolioExternalKey, mapDevfolio, type DevfolioGeo, type DevfolioInput } from './map.js';
import { DevfolioHackathon } from './schema.js';

/**
 * The Devfolio adapter (§7.2's Devfolio row, D-26, WP-12).
 *
 * Public server-rendered pages only: **one** listing request to
 * `devfolio.co/hackathons` per run (conditional, so an unchanged listing costs
 * a 304), then `<slug>.devfolio.co/` for items whose listing hash moved, within
 * the run's detail cap. Every subdomain is its own host: WP-09a's client
 * fetches and caches its robots.txt separately, and a subdomain whose robots
 * disallows `/` is skipped without a page request — the listing's data stands
 * in, with a `DETAIL_UNAVAILABLE` warning, and the run is PARTIAL.
 *
 * Buckets: `open_hackathons` and `upcoming_hackathons` are the walk;
 * `past_hackathons` only closes out records already held (§7.6), never adds
 * new ones; `featured_hackathons` repeats the others and is not walked.
 */

const Config = z
  .object({
    baseUrl: z.string().optional(),
    listingPath: z.string().optional(),
    deniedHosts: z.array(z.string()).optional(),
  })
  .loose();

interface DevfolioConfig {
  readonly listingUrl: string;
  readonly denied: readonly string[];
}

function configOf(raw: unknown): DevfolioConfig {
  const parsed = Config.safeParse(raw ?? {});
  const config = parsed.success ? parsed.data : {};
  const origin = new URL(config.baseUrl ?? DEVFOLIO_ORIGIN);
  if (origin.protocol !== 'https:' || origin.hostname !== 'devfolio.co') {
    throw new TypeError("Devfolio's listing is only ever read from https://devfolio.co.");
  }
  return {
    listingUrl: new URL(config.listingPath ?? '/hackathons', origin.origin).toString(),
    denied: config.deniedHosts ?? [],
  };
}

/** A format error from the pure extractor, as the run records it — with the body kept (§7.8). */
function asFormatError(error: unknown, response: PoliteResponse): unknown {
  if (error instanceof DevfolioFormatError) {
    return new AdapterFormatError(
      'SCHEMA_CHANGED',
      `Devfolio: ${error.message}`,
      error,
      response.body,
    );
  }
  return error;
}

function asItem(hackathon: DevfolioHackathon): ListingItem {
  const payload: DevfolioInput = { kind: 'listing', hackathon };
  return {
    externalKey: devfolioExternalKey(hackathon.uuid),
    url: hackathonUrl(hackathon.slug),
    payload,
    raw: new TextEncoder().encode(JSON.stringify(hackathon, null, 2)),
  };
}

export function createDevfolioAdapter(deps: { readonly geo: DevfolioGeo }): SourceAdapter {
  return {
    key: 'devfolio',
    displayName: 'Devfolio',
    kind: 'DEVFOLIO',
    needsBrowser: false,
    defaultCadenceMinutes: 15,

    listing: (context): ListingWalk =>
      (async function* listing(): ListingWalk {
        const config = configOf(context.config);
        await loadHtmlParser();
        const response = await fetchPage(context, config.listingUrl, {
          denied: config.denied,
          conditional: true,
        });
        if (response.notModified) {
          return { complete: true, notModified: true };
        }
        let page;
        try {
          page = extractListing(response.text());
        } catch (error) {
          throw asFormatError(error, response);
        }
        const seen = new Set<string>();
        const known = context.isKnown ?? (() => false);
        const walk = [
          ...page.open_hackathons,
          ...page.upcoming_hackathons,
          ...page.past_hackathons.filter((hackathon) => known(devfolioExternalKey(hackathon.uuid))),
        ];
        for (const hackathon of walk) {
          const key = devfolioExternalKey(hackathon.uuid);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          yield asItem(hackathon);
        }
        return { complete: true };
      })(),

    /**
     * WP-14: any `<slug>.devfolio.co` page stands for that hackathon.
     *
     * The external key is provisional — Devfolio's identity is the uuid inside
     * the page, not the slug — so it is marked as such and the import replaces
     * it with the normalized candidate's own key once the page has been read.
     */
    itemFromUrl(url: string): ListingItem | undefined {
      const slug = slugOf(url);
      return slug === undefined
        ? undefined
        : { externalKey: `devfolio:slug:${slug}`, url: hackathonUrl(slug), payload: undefined };
    },

    async detail(context: AdapterContext, item: ListingItem): Promise<RawDetail> {
      const config = configOf(context.config);
      const slug = slugOf(item.url);
      if (slug === undefined) {
        context.log.warn({ externalKey: item.externalKey }, 'not a Devfolio hackathon URL');
        return { item, payload: undefined };
      }
      await loadHtmlParser();
      let response: PoliteResponse;
      try {
        response = await fetchPage(context, hackathonUrl(slug), { denied: config.denied });
      } catch (error) {
        if (error instanceof ScrapeRequestError && error.refusal === 'ROBOTS_DISALLOWED') {
          // The subdomain's own robots.txt says no: no page request, the
          // listing's data stands in, and the run is PARTIAL.
          const listed = DevfolioHackathon.safeParse(
            (item.payload as { hackathon?: unknown } | undefined)?.hackathon,
          );
          const payload: DevfolioInput | undefined = listed.success
            ? {
                kind: 'listing',
                hackathon: listed.data,
                unavailable: `${slug}.devfolio.co's robots.txt disallows the hackathon page, so only the listing's fields are known.`,
              }
            : undefined;
          return { item, payload, degraded: true };
        }
        throw error;
      }
      try {
        const payload: DevfolioInput = { kind: 'detail', page: extractDetail(response.text()) };
        return { item, payload, raw: response.body };
      } catch (error) {
        throw asFormatError(error, response);
      }
    },

    normalize: (input: ListingItem | RawDetail, ctx: NormalizeContext): EventCandidate => {
      const payload = input.payload as DevfolioInput | undefined;
      if (payload === undefined || (payload.kind !== 'listing' && payload.kind !== 'detail')) {
        throw new TypeError('The payload is not a Devfolio hackathon.');
      }
      return mapDevfolio(payload, { clock: ctx.clock, sourceKey: ctx.sourceKey, geo: deps.geo });
    },
  };
}
