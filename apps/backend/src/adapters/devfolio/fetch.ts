import { AppError } from '../../platform/errors.js';
import type { PoliteResponse, RequestOptions } from '../../scraping/http/index.js';
import type { AdapterContext } from '../../sources/types.js';

/**
 * The only way the Devfolio adapter reaches the network.
 *
 * **`api.devfolio.co` is never called.** It is Devfolio's own undocumented
 * front-end API. The host is refused here, before a request is formed and so
 * before the transport — the gate's `!api.devfolio.co` entry would refuse it
 * too, but a request that is never built cannot be mis-authorized. URLs found
 * inside a payload are never passed here: every URL this adapter requests is
 * built from a validated slug.
 */

/** Hosts refused whatever the configuration says. */
export const FORBIDDEN_HOSTS: readonly string[] = ['api.devfolio.co'];

export const DEVFOLIO_ORIGIN = 'https://devfolio.co';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function forbidden(host: string, denied: readonly string[]): boolean {
  const lower = host.toLowerCase();
  return [...FORBIDDEN_HOSTS, ...denied].some(
    (entry) => lower === entry.toLowerCase() || lower.endsWith(`.${entry.toLowerCase()}`),
  );
}

export function hostForbiddenError(host: string): AppError {
  return new AppError({
    code: 'SOURCE_HOST_FORBIDDEN',
    status: 403,
    title: 'That host is never contacted',
    detail: `${host} is Devfolio's private API and is never called; only its public pages are read.`,
    retryable: false,
  });
}

/** GETs a page after refusing the forbidden hosts. Zero transport calls for them. */
export async function fetchPage(
  context: AdapterContext,
  url: string,
  options: { readonly denied?: readonly string[]; readonly conditional?: boolean } = {},
): Promise<PoliteResponse> {
  const host = new URL(url).hostname;
  if (forbidden(host, options.denied ?? [])) {
    throw hostForbiddenError(host);
  }
  const request: RequestOptions = {
    signal: context.signal,
    accept: 'text/html,application/xhtml+xml',
    ...(options.conditional === true ? { conditional: true } : {}),
  };
  return context.http.get(url, request);
}

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/** `https://<slug>.devfolio.co/` — built from a validated slug, never from payload text. */
export function hackathonUrl(slug: string): string {
  if (!isValidSlug(slug)) {
    throw new TypeError(`"${slug}" is not a Devfolio hackathon slug.`);
  }
  return `https://${slug}.devfolio.co/`;
}

/** The slug back out of a URL this adapter built, or `undefined`. */
export function slugOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9-]+)\.devfolio\.co$/.exec(host);
    const slug = match?.[1];
    return slug !== undefined && isValidSlug(slug) && slug !== 'api' ? slug : undefined;
  } catch {
    return undefined;
  }
}
