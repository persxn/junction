import { AppError } from '../../platform/errors.js';
import type { PoliteResponse } from '../../scraping/http/index.js';
import type { AdapterContext } from '../../sources/types.js';

/**
 * The only way the Unstop adapter reaches the network (R70, WP-13).
 *
 * A deny list checked **before a request is formed**: user profiles, register
 * pages, attachments, mentor booking, certificates, and any `/api/` path that
 * is not `/api/public/`. robots.txt and `allowed_paths_json` still apply
 * through WP-09a's client and gate — this is belt and braces. Every URL this
 * adapter requests is built from numbers and fixed paths; a URL found inside a
 * payload is stored, never followed.
 */

const DENIED: readonly RegExp[] = [
  /^\/u\//i,
  /^\/p\//i,
  /^\/pf\//i,
  /^\/directory\/user\//i,
  /^\/certificate-preview\//i,
  /^\/mentor\/book-mentor\//i,
  /^\/api\/get-attachment\//i,
  /^\/competitions\/[^/]+\/register(?:\/|$)/i,
  /^\/hackathons\/[^/]+\/register(?:\/|$)/i,
];

export function pathForbiddenError(url: string): AppError {
  return new AppError({
    code: 'SOURCE_PATH_FORBIDDEN',
    status: 403,
    title: 'That Unstop path is never requested',
    detail: `${url} is outside what Unstop's verdict allows (R70): no profiles, register pages or private API.`,
    retryable: false,
  });
}

/** Whether a URL is one the adapter must never request. Pure. */
export function isForbidden(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'unstop.com' && host !== 'www.unstop.com') {
    return true;
  }
  const path = url.pathname;
  if (path.startsWith('/api/') && !path.startsWith('/api/public/')) {
    return true;
  }
  return DENIED.some((pattern) => pattern.test(path));
}

export async function fetchUnstop(
  context: AdapterContext,
  url: string,
  accept = 'application/json',
): Promise<PoliteResponse> {
  if (isForbidden(url)) {
    throw pathForbiddenError(url);
  }
  return context.http.get(url, { signal: context.signal, accept });
}
