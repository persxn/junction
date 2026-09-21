import type { EventCandidate } from '@compintel/contracts';
import { z } from 'zod';

import { asCandidateSeries, detectSeries, type SeriesSubject } from '../../domain/series/index.js';
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
import { clistExternalKey, mapClistContest } from './map.js';
import { ClistContest, ClistListing } from './schema.js';

/**
 * The CLIST adapter (§7.2's CLIST row, D-26, WP-11) — key-gated and
 * fixture-first: CLIST has never been called (U4 is open).
 *
 * `/api/v4/contest/` is the only endpoint the listing reads, bounded to
 * *now − 1 day … now + 90 days*, 100 per page, `offset` pagination against
 * `meta.total_count`. The API key never passes through here: the polite client
 * adds it from the source's credential, and a run with no key never reaches
 * this code (the orchestrator records BLOCKED_BY_POLICY with zero requests).
 *
 * There is no `detail()` — the listing carries every documented field.
 *
 * Like CTFtime's, the listing is read whole before anything is yielded, which
 * makes a format failure write nothing and gives series detection (§7.3,
 * `domain/series`) every sibling it needs for cadence inference.
 */

export const CLIST_ORIGIN = 'https://clist.by';
export const CLIST_PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

const Config = z.object({ baseUrl: z.string().optional() }).loose();

/** `/api/v4/contest/?…` for one page of the window. */
export function clistListingUrl(
  origin: string,
  window: { readonly from: Date; readonly to: Date },
  offset: number,
): string {
  const url = new URL('/api/v4/contest/', origin);
  const iso = (at: Date): string => at.toISOString().slice(0, 19);
  url.searchParams.set('start__gte', iso(window.from));
  url.searchParams.set('start__lte', iso(window.to));
  url.searchParams.set('order_by', 'start');
  url.searchParams.set('limit', String(CLIST_PAGE_SIZE));
  url.searchParams.set('offset', String(Math.max(0, Math.trunc(offset))));
  return url.toString();
}

function originOf(config: unknown): string {
  const parsed = Config.safeParse(config ?? {});
  const base = parsed.success ? parsed.data.baseUrl : undefined;
  const url = new URL(base ?? CLIST_ORIGIN);
  if (url.protocol !== 'https:') {
    throw new TypeError(`"${String(base)}" is not an https origin.`);
  }
  return url.origin;
}

/** A 401 from CLIST means the key, not our politeness; it is said so (WP-11). */
async function get(context: AdapterContext, url: string): Promise<PoliteResponse> {
  try {
    return await context.http.get(url, { signal: context.signal, accept: 'application/json' });
  } catch (error) {
    if (error instanceof ScrapeRequestError && error.status === 401) {
      throw new ScrapeRequestError({
        kind: 'HTTP_4XX',
        status: 401,
        message:
          'CLIST answered 401: the API key or account name may be invalid or revoked (U4). ' +
          'Store a working credential through the admin credential route.',
        cause: error,
      });
    }
    throw error;
  }
}

function parsePage(response: PoliteResponse): ClistListing {
  let json: unknown;
  try {
    json = response.json();
  } catch (error) {
    throw new AdapterFormatError(
      'SCHEMA_CHANGED',
      'CLIST answered with something that is not JSON.',
      error,
      response.body,
    );
  }
  const parsed = ClistListing.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new AdapterFormatError(
      'SCHEMA_CHANGED',
      `CLIST's contest listing no longer has the documented shape (${issues}).`,
      parsed.error,
      response.body,
    );
  }
  return parsed.data;
}

/** The walk: pages until `total_count` is covered or the request budget runs out (A8). */
async function walk(
  context: AdapterContext,
): Promise<{ contests: ClistContest[]; raws: unknown[]; complete: boolean }> {
  const origin = originOf(context.config);
  const now = context.now().getTime();
  const window = { from: new Date(now - DAY_MS), to: new Date(now + 90 * DAY_MS) };
  const contests: ClistContest[] = [];
  const raws: unknown[] = [];
  let offset = 0;
  for (;;) {
    if (context.signal.aborted || context.http.requestsRemaining === 0) {
      return { contests, raws, complete: false };
    }
    const response = await get(context, clistListingUrl(origin, window, offset));
    const page = parsePage(response);
    const rawObjects = (response.json() as { objects?: unknown[] }).objects ?? [];
    contests.push(...page.objects);
    raws.push(...rawObjects);
    offset += page.objects.length;
    if (page.objects.length === 0 || offset >= page.meta.total_count) {
      return { contests, raws, complete: true };
    }
  }
}

function subjectOf(contest: ClistContest): SeriesSubject {
  return {
    title: contest.event,
    // CLIST lists coding contests; the hackathon rule in `domain/series` looks
    // at the title words through the event type the mapper will assign.
    eventType: /\bhack(?:athon)?\b/i.test(contest.event) ? 'HACKATHON' : 'CODING_CONTEST',
    resource: contest.resource,
    startsAt: Date.parse(`${contest.start.slice(0, 19)}Z`),
  };
}

export function createClistAdapter(): SourceAdapter {
  return {
    key: 'clist',
    displayName: 'CLIST',
    kind: 'CLIST_API',
    needsBrowser: false,
    defaultCadenceMinutes: 30,

    listing: (context): ListingWalk =>
      (async function* listing(): ListingWalk {
        const { contests, raws, complete } = await walk(context);
        const subjects = contests.map(subjectOf);
        for (const [index, contest] of contests.entries()) {
          const series = asCandidateSeries(detectSeries(subjects[index]!, subjects));
          yield {
            externalKey: clistExternalKey(contest.id),
            url: `https://clist.by/contest/${String(contest.id)}/`,
            payload: { contest, ...(series === undefined ? {} : { series }) },
            raw: new TextEncoder().encode(JSON.stringify(raws[index] ?? contest, null, 2)),
          };
        }
        return { complete };
      })(),

    normalize: (input: ListingItem | RawDetail, ctx: NormalizeContext): EventCandidate => {
      const payload = input.payload as { contest?: unknown; series?: EventCandidate['series'] };
      const contest = ClistContest.safeParse(payload.contest);
      if (!contest.success) {
        throw new TypeError('The payload is not a CLIST contest.');
      }
      return mapClistContest(contest.data, {
        clock: ctx.clock,
        sourceKey: ctx.sourceKey,
        series: payload.series,
      });
    },
  };
}
