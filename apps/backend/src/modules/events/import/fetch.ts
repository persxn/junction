import { AppError } from '../../../platform/errors.js';
import type { SourceRow } from '../../../db/schema/index.js';
import {
  ScrapeRequestError,
  type PoliteResponse,
  type ScrapingHttp,
  type SourceRequestContext,
} from '../../../scraping/http/index.js';
import { sourceRequestContext } from '../../../scraping/source-row.js';
import { importRobotsDisallowed, importUnreachable, importUnsupportedContent } from './errors.js';
import { sourceBlockedByPolicy } from '../../sources/errors.js';

/**
 * The generic path's one request (§7.1, D-30, WP-14 step 5).
 *
 * **Exactly one page, once.** No link is followed, no second page is fetched,
 * and there is no listing walk to resume: the budget handed to the client is one
 * request, so "no crawling" is a property of the object the caller holds rather
 * than a rule somebody has to remember.
 *
 * The host is not knowable in advance — a professor may paste any campus site —
 * so the allowance is built here, for this request, naming that one host. The
 * stored `allowed_paths_json` of the `url-import` row stays empty, which means
 * nothing else can borrow the row to reach anywhere at all. Everything else is
 * the ordinary gate: compliance status, robots.txt for that host, the effective
 * delay, the User-Agent with the professor's address (A10), the 5 MB cap.
 */

/** Media types a page may answer with. Anything else is not a page (§7.1). */
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

/** The `url-import` row's context, narrowed to the one host being imported. */
export function importRequestContext(source: SourceRow, url: URL): SourceRequestContext {
  return { ...sourceRequestContext(source), allowedPaths: [url.hostname.toLowerCase()] };
}

export interface ImportFetchDeps {
  readonly http: ScrapingHttp;
  /** The seeded `url-import` row; its compliance status still decides. */
  readonly source: SourceRow;
  readonly signal?: AbortSignal;
}

/** A refusal or a failure, translated into something the form can show. */
function asProblem(error: unknown, url: string, host: string): AppError {
  if (!(error instanceof ScrapeRequestError)) {
    return importUnreachable(url, 'an unexpected error');
  }
  if (error.refusal === 'ROBOTS_DISALLOWED' || error.kind === 'ROBOTS_DISALLOWED') {
    return importRobotsDisallowed(host);
  }
  if (error.refusal !== undefined) {
    return sourceBlockedByPolicy(error.message);
  }
  if (error.message.includes('larger than')) {
    return new AppError({
      code: 'IMPORT_TOO_LARGE',
      status: 413,
      title: 'That page is too large to read',
      detail: `${url} is over the 5 MB limit, so it was not read.`,
      hint: 'Type the details in — the link is saved with the event.',
      retryable: false,
    });
  }
  return importUnreachable(url, error.message);
}

export interface FetchedPage {
  readonly html: string;
  readonly contentType: string;
  readonly finalUrl: string;
}

/** Reads one page, or explains why it did not. Makes at most one request. */
export async function fetchImportPage(deps: ImportFetchDeps, url: string): Promise<FetchedPage> {
  const target = new URL(url);
  const client = deps.http.clientFor(
    importRequestContext(deps.source, target),
    deps.signal ?? new AbortController().signal,
    { maxRequests: 1 },
  );
  let response: PoliteResponse;
  try {
    response = await client.get(url, {
      accept: 'text/html,application/xhtml+xml;q=0.9',
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });
  } catch (error) {
    throw asProblem(error, url, target.hostname);
  }
  const contentType = (response.headers['content-type'] ?? '').toLowerCase();
  if (!HTML_TYPES.some((type) => contentType.includes(type))) {
    // A PDF, an image, a JSON API: read once, refused, never parsed as HTML.
    throw importUnsupportedContent(contentType === '' ? undefined : contentType.split(';')[0]);
  }
  return { html: response.text(), contentType, finalUrl: response.url };
}
