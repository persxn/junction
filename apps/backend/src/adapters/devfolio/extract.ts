import { parseHtml } from '../shared/html.js';
import type { z } from 'zod';

import {
  DevfolioDetailPage,
  DevfolioListingPage,
  type DevfolioDetailPage as DetailPage,
  type DevfolioListingPage as ListingPage,
} from './schema.js';

/**
 * Reading Devfolio's server-rendered page data. **Pure** over an HTML string.
 *
 * Next.js embeds the page's data as JSON in
 * `<script id="__NEXT_DATA__" type="application/json">`. It is found with
 * cheerio — never a regular expression over the document — parsed, and
 * `props.pageProps` is validated. Anything that is not exactly that shape is a
 * format change, and a format change is loud: a {@link DevfolioFormatError}
 * that the adapter turns into `SCHEMA_CHANGED`.
 */

export class DevfolioFormatError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DevfolioFormatError';
  }
}

/** The `__NEXT_DATA__` JSON of a page. `loadHtmlParser()` must have run first. */
export function nextData(html: string): unknown {
  const $ = parseHtml(html);
  const script = $('script#__NEXT_DATA__').first();
  if (script.length === 0) {
    throw new DevfolioFormatError('The page has no __NEXT_DATA__ script.');
  }
  try {
    return JSON.parse(script.text()) as unknown;
  } catch (error) {
    throw new DevfolioFormatError('The __NEXT_DATA__ script is not JSON.', error);
  }
}

function pageProps<T>(html: string, schema: z.ZodType<T>, what: string): T {
  const data = nextData(html) as { props?: { pageProps?: unknown } } | null;
  const props = data?.props?.pageProps;
  const parsed = schema.safeParse(props);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new DevfolioFormatError(
      `The ${what} page data no longer has the documented shape (${issues}).`,
      parsed.error,
    );
  }
  return parsed.data;
}

/** `devfolio.co/hackathons` → its four buckets. */
export function extractListing(html: string): ListingPage {
  return pageProps(html, DevfolioListingPage, 'listing');
}

/** `<slug>.devfolio.co/` → the hackathon and its prize summary. */
export function extractDetail(html: string): DetailPage {
  return pageProps(html, DevfolioDetailPage, 'hackathon');
}

export { loadHtmlParser } from '../shared/html.js';
