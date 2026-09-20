import type { WarningCollector } from './warnings.js';

/**
 * URL cleaning (§7.3: "tracking parameters stripped from URLs; only http/https
 * URLs kept").
 *
 * Two reasons this is not cosmetic. A URL is part of how WP-10 decides two
 * scraped rows are the same event, and `?utm_source=newsletter` on one of them
 * would defeat that. And a `javascript:` or `data:` URL reaching the UI from a
 * scraped page is the one genuinely dangerous thing a source can hand us.
 */

/** Analytics and campaign parameters, which identify a *visit*, not a page. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
]);

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * A canonical form of `raw`, or `undefined` if it is not a usable http(s) URL.
 *
 * Canonical means: lower-case host, no default port, no tracking parameters, no
 * fragment. The path's case is left alone — plenty of servers care about it.
 */
export function normalizeUrl(
  raw: string,
  warnings?: WarningCollector,
  field?: string,
): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    warnings?.add('URL_INVALID', `Not a URL: ${trimmed.slice(0, 80)}`, field);
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    warnings?.add('URL_INVALID', `Only http and https URLs are kept; got ${url.protocol}`, field);
    return undefined;
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.port === DEFAULT_PORTS[url.protocol]) {
    url.port = '';
  }
  // A fragment addresses a place *within* a page, never a different event.
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  // `toString()` keeps a bare "?" when every parameter was stripped.
  return url.toString().replace(/\?$/, '');
}

/** The registrable host of a URL, lower-cased; used to recognise a source. */
export function hostOf(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
