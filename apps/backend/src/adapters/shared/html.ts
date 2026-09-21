import type { CheerioAPI } from 'cheerio';

/**
 * cheerio, loaded on first use rather than at startup: the backend imports every
 * adapter when it boots, and a parser only the HTML adapters need should not
 * slow the READY line down (it measurably did — WP-12). Devfolio and Unstop
 * share it.
 */
let loader: ((html: string) => CheerioAPI) | undefined;

/** Loads cheerio once; everything after it is synchronous and pure. */
export async function loadHtmlParser(): Promise<void> {
  loader ??= (await import('cheerio')).load;
}

/** A parsed document. `loadHtmlParser()` must have run first. */
export function parseHtml(html: string): CheerioAPI {
  if (loader === undefined) {
    throw new Error('Call loadHtmlParser() before parsing HTML.');
  }
  return loader(html);
}
