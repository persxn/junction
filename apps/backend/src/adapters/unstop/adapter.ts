import type { EventCandidate } from '@compintel/contracts';
import { z } from 'zod';

import {
  mapUnstop,
  publicUrlOf,
  unstopExternalKey,
  UNSTOP_ORIGIN,
  type UnstopInput,
} from '../../domain/unstop/map.js';
import { UnstopDetail, UnstopListingPage, UnstopOpportunity } from '../../domain/unstop/schema.js';
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
import { loadHtmlParser, parseHtml } from '../shared/html.js';
import { fetchUnstop } from './fetch.js';

/**
 * The Unstop adapter (R70–R73, WP-13).
 *
 * Listing over `/api/public/opportunity/search-result` — one query per
 * opportunity type (hackathons, competitions), paginated to `last_page` within
 * the run's request budget; details from `/api/public/competition/{id}` only
 * when a listing item changed (§7.2). The whole listing is read before anything
 * is yielded, so a drifted payload writes nothing (R71).
 *
 * **HTML fallback (step 6).** If the JSON listing is not JSON, 404s or no longer
 * matches, the run tries the robots-allowed `/hackathons/` and `/competitions/`
 * pages and reads Angular's embedded server state (`script#ng-state` or
 * `#serverApp-state`). If that is absent too — the SPA rendered client-side —
 * the run fails `SCHEMA_CHANGED`. No headless browser (out of scope).
 */

const Config = z
  .object({
    listingPath: z.string().optional(),
    opportunities: z.array(z.string()).optional(),
    perPage: z.number().int().min(1).max(100).optional(),
    detailPath: z.string().optional(),
  })
  .loose();

interface UnstopConfig {
  readonly listingPath: string;
  readonly opportunities: readonly string[];
  readonly perPage: number;
  readonly detailPath: string;
}

function configOf(raw: unknown): UnstopConfig {
  const parsed = Config.safeParse(raw ?? {});
  const config = parsed.success ? parsed.data : {};
  return {
    listingPath: config.listingPath ?? '/api/public/opportunity/search-result',
    opportunities: config.opportunities ?? ['hackathons', 'competitions'],
    perPage: config.perPage ?? 30,
    detailPath: config.detailPath ?? '/api/public/competition/',
  };
}

export function unstopListingUrl(config: UnstopConfig, opportunity: string, page: number): string {
  const url = new URL(config.listingPath, UNSTOP_ORIGIN);
  url.searchParams.set('opportunity', opportunity);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(config.perPage));
  url.searchParams.set('oppstatus', 'open');
  return url.toString();
}

function format(message: string, response: PoliteResponse, cause?: unknown): AdapterFormatError {
  return new AdapterFormatError('SCHEMA_CHANGED', `Unstop: ${message}`, cause, response.body);
}

/** A JSON body, or `undefined` when it is not JSON (a fallback trigger, not yet an error). */
function jsonOf(response: PoliteResponse): unknown {
  try {
    return response.json();
  } catch {
    return undefined;
  }
}

/** Every opportunity-shaped object inside Angular's embedded state. Pure over HTML. */
export function opportunitiesInPage(html: string): UnstopOpportunity[] {
  const $ = parseHtml(html);
  const script = $('script#ng-state, script#serverApp-state').first();
  if (script.length === 0) {
    return [];
  }
  let state: unknown;
  try {
    state = JSON.parse(script.text()) as unknown;
  } catch {
    return [];
  }
  const found = new Map<number, UnstopOpportunity>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const parsed = UnstopOpportunity.safeParse(entry);
        if (parsed.success) {
          found.set(parsed.data.id, parsed.data);
        } else {
          walk(entry, depth + 1);
        }
      }
      return;
    }
    Object.values(value).forEach((inner) => {
      walk(inner, depth + 1);
    });
  };
  walk(state, 0);
  return [...found.values()];
}

interface Walked {
  readonly items: {
    readonly item: UnstopOpportunity;
    readonly raw: unknown;
    readonly fromPage: boolean;
  }[];
  readonly complete: boolean;
}

async function walkApi(
  context: AdapterContext,
  config: UnstopConfig,
): Promise<Walked | 'FALLBACK'> {
  const items: Walked['items'] = [];
  const complete = true;
  for (const opportunity of config.opportunities) {
    for (let page = 1; ; page += 1) {
      if (context.signal.aborted || context.http.requestsRemaining === 0) {
        return { items, complete: false };
      }
      let response: PoliteResponse;
      try {
        response = await fetchUnstop(context, unstopListingUrl(config, opportunity, page));
      } catch (error) {
        if (error instanceof ScrapeRequestError && error.status === 404) {
          return 'FALLBACK';
        }
        throw error;
      }
      const json = jsonOf(response);
      const parsed = UnstopListingPage.safeParse(json);
      if (!parsed.success) {
        return 'FALLBACK';
      }
      const raws = (json as { data: { data: unknown[] } }).data.data ?? [];
      parsed.data.data.data.forEach((item, index) => {
        items.push({ item, raw: raws[index] ?? item, fromPage: false });
      });
      if (page >= parsed.data.data.last_page || parsed.data.data.data.length === 0) {
        break;
      }
    }
  }
  return { items, complete };
}

async function walkPages(context: AdapterContext): Promise<Walked> {
  await loadHtmlParser();
  const items: Walked['items'] = [];
  let last: PoliteResponse | undefined;
  for (const section of ['/hackathons/', '/competitions/']) {
    if (context.http.requestsRemaining === 0) {
      break;
    }
    last = await fetchUnstop(context, new URL(section, UNSTOP_ORIGIN).toString(), 'text/html');
    for (const item of opportunitiesInPage(last.text())) {
      items.push({ item, raw: item, fromPage: true });
    }
  }
  if (items.length === 0 && last !== undefined) {
    throw format(
      'the /api/public listing no longer matches and the /hackathons/ and /competitions/ pages carry no embedded state (the SPA renders client-side).',
      last,
    );
  }
  return { items, complete: false };
}

function asItem(entry: Walked['items'][number]): ListingItem {
  const payload: UnstopInput = { kind: 'listing', item: entry.item, fromPage: entry.fromPage };
  return {
    externalKey: unstopExternalKey(entry.item.id),
    url: publicUrlOf(entry.item),
    payload,
    raw: new TextEncoder().encode(JSON.stringify(entry.raw, null, 2)),
  };
}

export function createUnstopAdapter(): SourceAdapter {
  return {
    key: 'unstop',
    displayName: 'Unstop',
    kind: 'UNSTOP',
    needsBrowser: false,
    defaultCadenceMinutes: 15,

    listing: (context): ListingWalk =>
      (async function* listing(): ListingWalk {
        const config = configOf(context.config);
        const api = await walkApi(context, config);
        // A listing read from the fallback pages is never "complete": it is not
        // the listing §7.6 counts, so nothing is aged out of it.
        const walked = api === 'FALLBACK' ? await walkPages(context) : api;
        if (api === 'FALLBACK') {
          context.log.warn(
            { source: 'unstop' },
            'the /api/public listing did not answer as expected; read the HTML pages instead',
          );
        }
        const seen = new Set<number>();
        for (const entry of walked.items) {
          if (!seen.has(entry.item.id)) {
            seen.add(entry.item.id);
            yield asItem(entry);
          }
        }
        return { complete: walked.complete };
      })(),

    /**
     * WP-14: `unstop.com/hackathons/<slug>-1123456` or `/competitions/<id>`.
     *
     * The id is the trailing number of the public path, which is the same id
     * `/api/public/competition/{id}` takes. A profile or a register page has no
     * such path and is refused here, before the deny list is even consulted.
     */
    itemFromUrl(url: string): ListingItem | undefined {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return undefined;
      }
      if (parsed.hostname.toLowerCase().replace(/^www\./, '') !== 'unstop.com') {
        return undefined;
      }
      const path = /^\/(hackathons|competitions)\/([a-z0-9-]+)\/?$/i.exec(parsed.pathname);
      const id = /(\d{3,12})$/.exec(path?.[2] ?? '')?.[1];
      if (path === undefined || path === null || id === undefined) {
        return undefined;
      }
      return {
        externalKey: unstopExternalKey(Number(id)),
        url: `${UNSTOP_ORIGIN}/${path[1]}/${path[2]}`,
        payload: undefined,
      };
    },

    async detail(context: AdapterContext, item: ListingItem): Promise<RawDetail> {
      const config = configOf(context.config);
      const id = /^unstop:(\d{1,12})$/.exec(item.externalKey)?.[1];
      if (id === undefined) {
        return { item, payload: undefined };
      }
      const response = await fetchUnstop(
        context,
        new URL(`${config.detailPath}${id}`, UNSTOP_ORIGIN).toString(),
      );
      const parsed = UnstopDetail.safeParse(jsonOf(response));
      if (!parsed.success) {
        throw format(
          'a competition detail no longer has the expected shape.',
          response,
          parsed.error,
        );
      }
      const payload: UnstopInput = { kind: 'detail', competition: parsed.data.data.competition };
      return { item, payload, raw: response.body };
    },

    normalize: (input: ListingItem | RawDetail, ctx: NormalizeContext): EventCandidate => {
      const payload = input.payload as UnstopInput | undefined;
      if (payload === undefined || (payload.kind !== 'listing' && payload.kind !== 'detail')) {
        throw new TypeError('The payload is not an Unstop opportunity.');
      }
      return mapUnstop(payload, {
        clock: ctx.clock,
        sourceKey: ctx.sourceKey,
        defaultTimeZone: ctx.defaultTimeZone,
      });
    },
  };
}
