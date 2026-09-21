/**
 * The only two URLs this adapter can build (§7.2's CTFtime row, D-26).
 *
 * `/api/v1/events/` and `/api/v1/events/{id}/` are the whole of what CTFtime
 * approved us for, and both are built here from numbers. Nothing a payload says
 * is ever concatenated into a request URL: a `ctftime_url` or `url` field is
 * stored, never followed, and an id that is not a plain positive integer is
 * refused before any URL exists. The compliance gate would refuse a stray path
 * too, but a request that is never constructed cannot be mis-authorized.
 */

/** The API root. `config_json.baseUrl` may only point it at another origin. */
export const CTFTIME_BASE_URL = 'https://ctftime.org';

/** CTFtime caps `limit` at 100 server-side (`source-feasibility.md` §1.1). */
export const CTFTIME_MAX_LIMIT = 100;

const NUMERIC_ID = /^[1-9]\d{0,9}$/;

/** A CTFtime event id as a canonical decimal string, or `undefined`. */
export function parseEventId(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value === 'string' && NUMERIC_ID.test(value)) {
    return value;
  }
  return undefined;
}

/** `https://ctftime.org` without a trailing slash, or throws for a non-origin. */
export function apiOrigin(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search !== '') {
    throw new TypeError(`"${baseUrl}" is not an https origin.`);
  }
  return parsed.origin;
}

/** `/api/v1/events/?limit=…&start=…&finish=…`, with Unix seconds. */
export function listingUrl(
  origin: string,
  window: { readonly startSec: number; readonly finishSec: number },
  limit: number,
): string {
  const url = new URL('/api/v1/events/', origin);
  url.searchParams.set(
    'limit',
    String(Math.min(Math.max(1, Math.trunc(limit)), CTFTIME_MAX_LIMIT)),
  );
  url.searchParams.set('start', String(Math.trunc(window.startSec)));
  url.searchParams.set('finish', String(Math.trunc(window.finishSec)));
  return url.toString();
}

/** `/api/v1/events/{id}/`. Throws for anything but a numeric id. */
export function detailUrl(origin: string, id: unknown): string {
  const parsed = parseEventId(id);
  if (parsed === undefined) {
    throw new TypeError(`"${String(id)}" is not a CTFtime event id.`);
  }
  return new URL(`/api/v1/events/${parsed}/`, origin).toString();
}

/** The public event page. Stored as the record's URL; never requested. */
export function eventPageUrl(origin: string, id: string): string {
  return new URL(`/event/${id}/`, origin).toString();
}
