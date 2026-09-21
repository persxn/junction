import type { CheerioAPI } from 'cheerio';

import { cleanText, fillGaps, type FoundEvent } from './found.js';
import { eventFromJsonLd } from './json-ld.js';

/**
 * The generic single-page extractor (§4.8, §7.1's URL-import bullet).
 *
 * One page, read in §4.8's order: schema.org `Event` JSON-LD, then Open Graph
 * and Twitter cards, then heuristics over the document itself. **Later readers
 * only fill gaps** — a `<h1>` never overwrites a structured `startDate`.
 *
 * Pure: the HTML parser arrives as an argument, so nothing here loads cheerio,
 * reaches a network or reads a clock. The dates it finds stay as *text*; WP-08a
 * parses them, with its timezone rules and its warnings, exactly as it does for
 * an adapter.
 *
 * Nothing is invented. A page with no title yields no title, and the preview
 * says so rather than offering the professor a tidy guess to click past.
 */

export type HtmlParser = (html: string) => CheerioAPI;

export interface ExtractInput {
  readonly html: string;
  /** The page's own URL, for resolving relative links. */
  readonly url: string;
  readonly parse: HtmlParser;
}

function meta($: CheerioAPI, names: readonly string[]): string | undefined {
  for (const name of names) {
    const byProperty = $(`meta[property="${name}"]`).attr('content');
    const byName = $(`meta[name="${name}"]`).attr('content');
    const value = cleanText(byProperty ?? byName);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function absolute(href: string | undefined, base: string): string | undefined {
  if (href === undefined || href.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Open Graph and Twitter cards: the site's own summary of its page. */
function fromCards($: CheerioAPI, url: string): FoundEvent {
  const out: Record<string, unknown> = {};
  const put = (
    field: string,
    value: string | undefined,
    origin: 'OPEN_GRAPH' | 'TWITTER_CARD',
  ): void => {
    if (value !== undefined) {
      out[field] = { value, origin, confidence: 0.8, raw: value };
    }
  };
  const ogTitle = meta($, ['og:title']);
  const ogDescription = meta($, ['og:description']);
  put('title', ogTitle, 'OPEN_GRAPH');
  put('description', ogDescription, 'OPEN_GRAPH');
  if (ogTitle === undefined) {
    put('title', meta($, ['twitter:title']), 'TWITTER_CARD');
  }
  if (ogDescription === undefined) {
    put('description', meta($, ['twitter:description', 'description']), 'TWITTER_CARD');
  }
  put('organizerName', meta($, ['og:site_name']), 'OPEN_GRAPH');
  put('officialUrl', absolute(meta($, ['og:url']), url), 'OPEN_GRAPH');
  return out;
}

/** Phrases that introduce a date, in the order they are looked for. */
const DATE_LABELS: Readonly<Record<string, readonly string[]>> = {
  registrationDeadlineAt: [
    'registration deadline',
    'registration closes',
    'registration ends',
    'last date to register',
    'last date of registration',
    'apply by',
    'deadline to apply',
  ],
  startsAt: ['event date', 'starts on', 'start date', 'date of event', 'happening on', 'when'],
  endsAt: ['ends on', 'end date', 'until'],
};

/**
 * Words that end a value without being a label of their own: the call to action
 * that follows almost every fact on a fest page ("Prize pool ₹50,000 Register
 * now"). Without them the prize would be read as "₹50,000 Register now".
 */
const ACTION_STOPS: readonly string[] = [
  'register',
  'apply now',
  'click here',
  'read more',
  'learn more',
  'know more',
];

const TEXT_LABELS: Readonly<Record<string, readonly string[]>> = {
  feeText: ['registration fee', 'entry fee', 'participation fee', 'fee'],
  prizeText: ['prize pool', 'total prize', 'prizes worth', 'prize money', 'prize'],
  teamSizeText: ['team size', 'team of', 'members per team', 'participants per team'],
};

/**
 * The words just after a label — "Registration closes: 30 Sep 2026" gives
 * "30 Sep 2026".
 *
 * A fixed window rather than sentence detection, because campus pages put these
 * in table cells and list items where there is no sentence to detect. The window
 * is what WP-08a's parser is then asked about; if it makes nothing of it, the
 * field stays empty and a warning says why.
 */
export interface AfterLabelOptions {
  /** How many characters after the label may belong to the value. */
  readonly window?: number;
  /**
   * Other labels on the page. The value ends where the next one begins, which
   * is what stops "Registration fee: Free" from swallowing the "Prize pool:
   * ₹50,000" in the next table row — a campus page is a list of labels, not
   * sentences, so there is no full stop to stop at.
   */
  readonly stops?: readonly string[];
}

export function afterLabel(
  text: string,
  labels: readonly string[],
  options: AfterLabelOptions = {},
): string | undefined {
  const window = options.window ?? 60;
  const haystack = text.toLowerCase();
  for (const label of labels) {
    const at = haystack.indexOf(label);
    if (at === -1) {
      continue;
    }
    const from = at + label.length;
    let tail = text.slice(from, from + window);
    const lower = tail.toLowerCase();
    let cut = tail.length;
    for (const stop of options.stops ?? []) {
      const found = lower.indexOf(stop);
      if (found > 0 && found < cut) {
        cut = found;
      }
    }
    tail = tail
      .slice(0, cut)
      .replace(/^[\s:–—-]+/, '')
      .trim();
    const value = cleanText(tail.split(/[.;|]/)[0] ?? tail, 200);
    if (value !== undefined && value.length > 1) {
      return value;
    }
  }
  return undefined;
}

/** Anchors that look like "register here", strongest match first. */
function registrationLink($: CheerioAPI, url: string): string | undefined {
  const wanted = /regist|apply|sign[\s-]?up|enrol/i;
  let fallback: string | undefined;
  for (const element of $('a[href]').toArray()) {
    const href = absolute($(element).attr('href'), url);
    if (href === undefined) {
      continue;
    }
    const label = cleanText($(element).text()) ?? '';
    if (wanted.test(label)) {
      return href;
    }
    if (fallback === undefined && wanted.test(href)) {
      fallback = href;
    }
  }
  return fallback;
}

/** The document itself: headings, `<time>`, labelled prose, the register link. */
function fromDocument($: CheerioAPI, url: string): FoundEvent {
  const out: Record<string, unknown> = {};
  const put = (field: string, value: string | undefined, confidence: number): void => {
    if (value !== undefined) {
      out[field] = { value, origin: 'HEURISTIC', confidence, raw: value };
    }
  };

  const heading = cleanText($('h1').first().text(), 300);
  // "CodeStorm 2026 | IIT Bombay" — the part before the site's own name.
  const documentTitle = cleanText($('title').first().text(), 300)?.split(/\s+[|–—]\s+/)[0];
  put('title', heading ?? documentTitle, heading === undefined ? 0.4 : 0.5);

  const paragraph = $('p')
    .toArray()
    .map((element) => cleanText($(element).text()))
    .find((text): text is string => text !== undefined && text.length >= 80);
  put('description', paragraph, 0.4);

  const times = $('time[datetime]')
    .toArray()
    .map((element) => cleanText($(element).attr('datetime')))
    .filter((value): value is string => value !== undefined);
  put('startsAt', times[0], 0.6);
  put('endsAt', times[1], 0.5);

  const body = cleanText($('body').text(), 200_000) ?? '';
  const entries = [...Object.entries(DATE_LABELS), ...Object.entries(TEXT_LABELS)];
  const everyLabel = entries.flatMap(([, labels]) => labels);
  for (const [field, labels] of entries) {
    const stops = [...everyLabel.filter((label) => !labels.includes(label)), ...ACTION_STOPS];
    put(field, afterLabel(body, labels, { stops }), 0.5);
  }
  put('registrationUrl', registrationLink($, url), 0.5);
  return out;
}

/** Every `<script type="application/ld+json">` on the page, as text. */
export function jsonLdScripts($: CheerioAPI): string[] {
  return $('script[type="application/ld+json"]')
    .toArray()
    .map((element) => $(element).text())
    .filter((text) => text.trim().length > 0);
}

/**
 * One page → what it says, in §4.8's order of preference. The caller decides
 * what to do with an empty result (`IMPORT_EXTRACTION_FAILED`).
 */
export function extractEvent(input: ExtractInput): FoundEvent {
  const $ = input.parse(input.html);
  const structured = eventFromJsonLd(jsonLdScripts($));
  const withCards = fillGaps(structured, fromCards($, input.url));
  return fillGaps(withCards, fromDocument($, input.url));
}
