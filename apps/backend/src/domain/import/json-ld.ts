import type { CandidatePlace, EventMode } from '@compintel/contracts';

import { cleanText, type Found, type FoundEvent } from './found.js';

/**
 * schema.org `Event` in `<script type="application/ld+json">` — the first and
 * best thing a generic page read can find (§4.8).
 *
 * Pure over the scripts' text, so it is testable without an HTML parser. The
 * shape is read defensively field by field rather than validated as a whole: a
 * page that gets `location` wrong should still give up its title and dates, and
 * a strict schema over somebody else's marketing site would refuse every page.
 *
 * WP-02 found **no** Event JSON-LD on 117 Indian campus sites, so this is the
 * best case and not the expected one.
 */

/** `@type` values that are an event, including schema.org's subtypes. */
const EVENT_TYPES = new Set([
  'event',
  'businessevent',
  'educationevent',
  'festival',
  'hackathon',
  'sportsevent',
  'socialevent',
  'exhibitionevent',
  'screeningevent',
  'courseinstance',
]);

const ATTENDANCE_MODE: Readonly<Record<string, EventMode>> = {
  onlineeventattendancemode: 'ONLINE',
  offlineeventattendancemode: 'OFFLINE',
  mixedeventattendancemode: 'HYBRID',
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typesOf(node: Json): string[] {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
}

/** Every object in a document, including `@graph` members and nested values. */
function walk(value: unknown, depth: number, out: Json[]): void {
  if (depth > 6) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      walk(entry, depth + 1, out);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  out.push(value);
  for (const entry of Object.values(value)) {
    walk(entry, depth + 1, out);
  }
}

/** The first `Event` node across every script on the page. */
export function firstEventNode(scripts: readonly string[]): Json | undefined {
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script) as unknown;
    } catch {
      continue;
    }
    const nodes: Json[] = [];
    walk(parsed, 0, nodes);
    const event = nodes.find((node) => typesOf(node).some((type) => EVENT_TYPES.has(type)));
    if (event !== undefined) {
      return event;
    }
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? cleanText(value) : undefined;
}

function found<T>(value: T | undefined, raw?: string): Found<T> | undefined {
  return value === undefined
    ? undefined
    : { value, origin: 'JSON_LD', confidence: 1, ...(raw === undefined ? {} : { raw }) };
}

/** `name` from a string, or from a nested `{ name }` (organizer, location). */
function namedOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return cleanText(value);
  }
  if (Array.isArray(value)) {
    return namedOf(value[0]);
  }
  return isObject(value) ? str(value.name) : undefined;
}

function countryOf(value: unknown): string | undefined {
  const name = namedOf(value);
  if (name === undefined) {
    return undefined;
  }
  // Only an ISO-3166 alpha-2 is taken as one; a country *name* is WP-08b's job.
  return /^[A-Za-z]{2}$/.test(name) ? name.toUpperCase() : undefined;
}

function placeOf(node: Json): CandidatePlace | undefined {
  const location: unknown = Array.isArray(node.location) ? node.location[0] : node.location;
  if (typeof location === 'string') {
    const venue = cleanText(location);
    return venue === undefined ? undefined : { venueName: venue };
  }
  if (!isObject(location)) {
    return undefined;
  }
  const address: Json = isObject(location.address) ? location.address : {};
  const place: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    if (value !== undefined) {
      place[key] = value;
    }
  };
  put('venueName', str(location.name));
  put('city', str(address.addressLocality));
  put('state', str(address.addressRegion));
  put('countryCode', countryOf(address.addressCountry));
  return Object.keys(place).length === 0 ? undefined : place;
}

/** `offers.price` / `priceCurrency`, or the free-text `offers.description`. */
function feeOf(node: Json): string | undefined {
  const offers: unknown = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  if (!isObject(offers)) {
    return undefined;
  }
  const price = offers.price;
  const currency = str(offers.priceCurrency);
  if (typeof price === 'number' || (typeof price === 'string' && price.trim().length > 0)) {
    const amount = String(price).trim();
    return currency === undefined ? amount : `${currency} ${amount}`;
  }
  return str(offers.description);
}

function registrationUrlOf(node: Json): string | undefined {
  const offers: unknown = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  return isObject(offers) ? str(offers.url) : undefined;
}

function modeOf(node: Json): EventMode | undefined {
  const raw = str(node.eventAttendanceMode)
    ?.toLowerCase()
    .replace(/^https?:\/\/schema\.org\//, '');
  return raw === undefined ? undefined : ATTENDANCE_MODE[raw];
}

/** Everything a schema.org `Event` on this page states, or an empty result. */
export function eventFromJsonLd(scripts: readonly string[]): FoundEvent {
  const node = firstEventNode(scripts);
  if (node === undefined) {
    return {};
  }
  const out: Record<string, unknown> = {};
  const put = <T>(field: keyof FoundEvent, value: T | undefined, raw?: string): void => {
    const entry = found(value, raw);
    if (entry !== undefined) {
      out[field] = entry;
    }
  };
  const description = str(node.description);
  const startDate = str(node.startDate);
  const endDate = str(node.endDate);
  const fee = feeOf(node);

  put('title', str(node.name));
  put('description', description, description);
  put('organizerName', namedOf(node.organizer));
  put('startsAt', startDate, startDate);
  put('endsAt', endDate, endDate);
  put('mode', modeOf(node));
  put('place', placeOf(node));
  put('feeText', fee, fee);
  put('officialUrl', str(node.url));
  put('registrationUrl', registrationUrlOf(node));
  return out;
}
