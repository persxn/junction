import type { EventCandidate } from '@compintel/contracts';
import { z } from 'zod';

import type { PoliteResponse } from '../../scraping/http/index.js';
import { AdapterFormatError } from '../../scraping/errors.js';
import type {
  AdapterContext,
  ListingItem,
  ListingWalk,
  NormalizeContext,
  RawDetail,
  SourceAdapter,
} from '../../sources/types.js';
import { mapCtftimeEvent, type CtftimeGeo } from './map.js';
import {
  apiOrigin,
  CTFTIME_BASE_URL,
  CTFTIME_MAX_LIMIT,
  detailUrl,
  eventPageUrl,
  listingUrl,
  parseEventId,
} from './paths.js';
import { CtftimeEvent, CtftimeListing } from './schema.js';

/**
 * The CTFtime adapter (§7.1, §7.2's CTFtime row, D-26/D-27).
 *
 * CTFtime publishes a documented JSON API with no key, and that API is the only
 * thing this adapter reads: `/api/v1/events/` for the listing and
 * `/api/v1/events/{id}/` for one event. Never an HTML page, never `/export/`,
 * never a login. Both URLs are built in `paths.ts` from numbers.
 *
 * **The listing is read whole before anything is yielded.** A page that is not
 * the documented shape therefore fails the run before a single `source_records`
 * row exists (`AdapterFormatError`'s contract), and the listing requests are
 * spent before any detail fetch, so the walk cannot be starved of budget by the
 * orchestrator's own detail step.
 */

/** §7.6: the walk is scoped to what starts in the next 120 days. */
export const LISTING_WINDOW_DAYS = 120;

const Config = z
  .object({
    baseUrl: z.string().optional(),
    listingLimit: z.number().int().min(1).max(CTFTIME_MAX_LIMIT).optional(),
  })
  .loose();

export interface CtftimeAdapterDependencies {
  /** WP-08b's geocoder; `Geocoder` satisfies this. */
  readonly geo: CtftimeGeo;
}

interface CtftimeConfig {
  readonly origin: string;
  readonly limit: number;
}

function readConfig(raw: unknown): CtftimeConfig {
  const parsed = Config.safeParse(raw ?? {});
  const config = parsed.success ? parsed.data : {};
  return {
    origin: apiOrigin(config.baseUrl ?? CTFTIME_BASE_URL),
    limit: config.listingLimit ?? CTFTIME_MAX_LIMIT,
  };
}

/** The response body as JSON, or `SCHEMA_CHANGED` with the bytes kept for §7.8. */
function readJson(response: PoliteResponse, what: string): unknown {
  try {
    return response.json();
  } catch (error) {
    throw new AdapterFormatError(
      'SCHEMA_CHANGED',
      `CTFtime answered ${what} with something that is not JSON.`,
      error,
      response.body,
    );
  }
}

/** Throws `SCHEMA_CHANGED` naming the first few keys that no longer fit. */
function schemaError(what: string, error: z.ZodError, body: Uint8Array): AdapterFormatError {
  const issues = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return new AdapterFormatError(
    'SCHEMA_CHANGED',
    `CTFtime's ${what} no longer has the documented shape (${issues}).`,
    error,
    body,
  );
}

function asItem(origin: string, event: CtftimeEvent, source: unknown): ListingItem {
  const id = String(event.id);
  return {
    externalKey: id,
    url: eventPageUrl(origin, id),
    payload: event,
    // One record's own object, re-serialized: the listing page holds a hundred
    // events, and snapshotting the whole page per record would store it a
    // hundred times over (§7.8).
    raw: new TextEncoder().encode(JSON.stringify(source, null, 2)),
  };
}

/**
 * Walks the window one page at a time. A page that comes back full may have
 * been cut off, so the window is narrowed to start at the latest start the page
 * contained and read again; a page shorter than the limit is the end.
 *
 * The narrowing relies on CTFtime returning events in start order. A full page
 * that is *not* in start order is not trusted to have been cut at its end, so
 * the walk stops and reports itself incomplete rather than claiming it saw
 * everything (A8).
 */
async function walkListing(
  context: AdapterContext,
  config: CtftimeConfig,
): Promise<{ items: ListingItem[]; complete: boolean }> {
  const startSec = Math.floor(context.now().getTime() / 1000);
  const finishSec = startSec + LISTING_WINDOW_DAYS * 86_400;
  const seen = new Map<string, ListingItem>();
  let windowStart = startSec;

  for (;;) {
    if (context.signal.aborted || context.http.requestsRemaining === 0) {
      return { items: [...seen.values()], complete: false };
    }
    const response = await context.http.get(
      listingUrl(config.origin, { startSec: windowStart, finishSec }, config.limit),
      { signal: context.signal },
    );
    const json = readJson(response, 'the event listing');
    const rawEvents: unknown[] = Array.isArray(json) ? json : [];
    const parsed = CtftimeListing.safeParse(json);
    if (!parsed.success) {
      throw schemaError('event listing', parsed.error, response.body);
    }
    parsed.data.forEach((event, index) => {
      seen.set(String(event.id), asItem(config.origin, event, rawEvents[index]));
    });

    if (parsed.data.length < config.limit) {
      return { items: [...seen.values()], complete: true };
    }
    const starts = parsed.data.map((event) => Date.parse(event.start));
    const ordered = starts.every(
      (at, index) => Number.isFinite(at) && (index === 0 || at >= (starts[index - 1] ?? at)),
    );
    const nextStart = Math.floor(Math.max(...starts) / 1000);
    if (!ordered || nextStart <= windowStart) {
      context.log.warn(
        { ordered, windowStart, nextStart },
        'a full CTFtime page could not be narrowed further; the walk is incomplete',
      );
      return { items: [...seen.values()], complete: false };
    }
    windowStart = nextStart;
  }
}

export function createCtftimeAdapter(deps: CtftimeAdapterDependencies): SourceAdapter {
  const normalize = (input: ListingItem | RawDetail, ctx: NormalizeContext): EventCandidate => {
    const payload = input.payload;
    const parsed = CtftimeEvent.safeParse(payload);
    if (!parsed.success) {
      throw new TypeError('The payload is not a CTFtime event.');
    }
    const candidate = mapCtftimeEvent(parsed.data, {
      clock: ctx.clock,
      sourceKey: ctx.sourceKey,
      origin: CTFTIME_BASE_URL,
      geo: deps.geo,
    });
    // CTFtime's dates are required structured fields and the best any source
    // offers. An event whose two dates contradict each other has had both
    // dropped (§7.3), and a CTF with no dates is not an event anyone can act
    // on: it is counted invalid, with the reason, rather than stored empty.
    if (candidate.startsAt === undefined) {
      const reasons = candidate.warnings.map((warning) => warning.code).join(', ');
      throw new TypeError(
        `CTFtime event ${candidate.externalKey} has no usable dates (${reasons}).`,
      );
    }
    return candidate;
  };

  return {
    key: 'ctftime',
    displayName: 'CTFtime',
    kind: 'CTFTIME_API',
    needsBrowser: false,
    defaultCadenceMinutes: 30,

    listing: (context): ListingWalk =>
      (async function* walk(): ListingWalk {
        const config = readConfig(context.config);
        const { items, complete } = await walkListing(context, config);
        for (const item of items) {
          yield item;
        }
        return { complete };
      })(),

    /** WP-14: `https://ctftime.org/event/1234/` — the id is the whole identity. */
    itemFromUrl(url: string): ListingItem | undefined {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return undefined;
      }
      if (parsed.hostname.toLowerCase().replace(/^www\./, '') !== 'ctftime.org') {
        return undefined;
      }
      const id = parseEventId(/^\/event\/(\d+)\/?$/.exec(parsed.pathname)?.[1]);
      return id === undefined
        ? undefined
        : { externalKey: id, url: `https://ctftime.org/event/${id}/`, payload: undefined };
    },

    async detail(context: AdapterContext, item: ListingItem): Promise<RawDetail> {
      const config = readConfig(context.config);
      const id = parseEventId(item.externalKey);
      if (id === undefined) {
        // No URL is built from it and no request is made. An empty payload
        // fails `normalize()`, so the orchestrator counts this one item invalid
        // instead of failing the whole run over it.
        context.log.warn({ externalKey: item.externalKey }, 'not a CTFtime event id');
        return { item, payload: undefined };
      }
      const response = await context.http.get(detailUrl(config.origin, id), {
        signal: context.signal,
      });
      const json = readJson(response, `event ${id}`);
      const parsed = CtftimeEvent.safeParse(json);
      if (!parsed.success) {
        throw schemaError(`event ${id}`, parsed.error, response.body);
      }
      return { item, payload: parsed.data, raw: response.body };
    },

    normalize,
  };
}
