/**
 * CTFtime's `location` — free text such as "Seoul, Korea" — split into what
 * the geocoder can use (§7.3, R55). Pure.
 *
 * The gazetteer knows cities, states and ISO codes but not country *names*, so
 * the last comma-separated part is read against the short table below. A
 * country missing from it is not guessed at: the place is left without a
 * country, and the geocoder's own ladder decides how precise it can be.
 *
 * The table also carries a zone for countries that have exactly one, because
 * CTFtime states no time zone at all and §7.3 says the venue decides next.
 * Countries spanning several zones (US, RU, AU, …) have none, and the event
 * falls through to UTC.
 */

interface CountryEntry {
  readonly code: string;
  /** Set only for single-zone countries. */
  readonly zone?: string;
}

const COUNTRIES: Readonly<Record<string, CountryEntry>> = {
  india: { code: 'IN', zone: 'Asia/Kolkata' },
  korea: { code: 'KR', zone: 'Asia/Seoul' },
  'south korea': { code: 'KR', zone: 'Asia/Seoul' },
  'republic of korea': { code: 'KR', zone: 'Asia/Seoul' },
  japan: { code: 'JP', zone: 'Asia/Tokyo' },
  china: { code: 'CN', zone: 'Asia/Shanghai' },
  taiwan: { code: 'TW', zone: 'Asia/Taipei' },
  singapore: { code: 'SG', zone: 'Asia/Singapore' },
  vietnam: { code: 'VN', zone: 'Asia/Ho_Chi_Minh' },
  'viet nam': { code: 'VN', zone: 'Asia/Ho_Chi_Minh' },
  thailand: { code: 'TH', zone: 'Asia/Bangkok' },
  malaysia: { code: 'MY', zone: 'Asia/Kuala_Lumpur' },
  philippines: { code: 'PH', zone: 'Asia/Manila' },
  indonesia: { code: 'ID' },
  bangladesh: { code: 'BD', zone: 'Asia/Dhaka' },
  pakistan: { code: 'PK', zone: 'Asia/Karachi' },
  'sri lanka': { code: 'LK', zone: 'Asia/Colombo' },
  nepal: { code: 'NP', zone: 'Asia/Kathmandu' },
  israel: { code: 'IL', zone: 'Asia/Jerusalem' },
  uae: { code: 'AE', zone: 'Asia/Dubai' },
  'united arab emirates': { code: 'AE', zone: 'Asia/Dubai' },
  'saudi arabia': { code: 'SA', zone: 'Asia/Riyadh' },
  qatar: { code: 'QA', zone: 'Asia/Qatar' },
  kazakhstan: { code: 'KZ' },
  russia: { code: 'RU' },
  ukraine: { code: 'UA', zone: 'Europe/Kyiv' },
  turkey: { code: 'TR', zone: 'Europe/Istanbul' },
  germany: { code: 'DE', zone: 'Europe/Berlin' },
  france: { code: 'FR', zone: 'Europe/Paris' },
  italy: { code: 'IT', zone: 'Europe/Rome' },
  spain: { code: 'ES' },
  netherlands: { code: 'NL', zone: 'Europe/Amsterdam' },
  poland: { code: 'PL', zone: 'Europe/Warsaw' },
  switzerland: { code: 'CH', zone: 'Europe/Zurich' },
  austria: { code: 'AT', zone: 'Europe/Vienna' },
  'czech republic': { code: 'CZ', zone: 'Europe/Prague' },
  czechia: { code: 'CZ', zone: 'Europe/Prague' },
  sweden: { code: 'SE', zone: 'Europe/Stockholm' },
  norway: { code: 'NO', zone: 'Europe/Oslo' },
  denmark: { code: 'DK', zone: 'Europe/Copenhagen' },
  finland: { code: 'FI', zone: 'Europe/Helsinki' },
  uk: { code: 'GB', zone: 'Europe/London' },
  'united kingdom': { code: 'GB', zone: 'Europe/London' },
  egypt: { code: 'EG', zone: 'Africa/Cairo' },
  morocco: { code: 'MA', zone: 'Africa/Casablanca' },
  tunisia: { code: 'TN', zone: 'Africa/Tunis' },
  usa: { code: 'US' },
  us: { code: 'US' },
  'united states': { code: 'US' },
  'united states of america': { code: 'US' },
  canada: { code: 'CA' },
  brazil: { code: 'BR' },
  mexico: { code: 'MX' },
  australia: { code: 'AU' },
};

/** Words that qualify a location rather than name it: "USA only". */
const QUALIFIERS = /\b(?:only|online|remote)\b/g;

function key(part: string): string {
  return part.toLowerCase().replace(/\./g, '').replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
}

export interface StatedLocation {
  readonly city?: string;
  readonly countryCode?: string;
}

/**
 * "Seoul, Korea" → `{ city: 'Seoul', countryCode: 'KR' }`.
 * "USA only" → `{ countryCode: 'US' }`. "" → `undefined`.
 *
 * With one part, a known country name is a country and anything else is taken
 * as a city for the geocoder to try; with several, the last is the country and
 * the first is the city.
 */
export function parseLocation(text: string): StatedLocation | undefined {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) {
    return undefined;
  }
  const last = parts[parts.length - 1] ?? first;
  const country = COUNTRIES[key(last)];
  if (parts.length === 1) {
    return country === undefined ? { city: first } : { countryCode: country.code };
  }
  return { city: first, ...(country === undefined ? {} : { countryCode: country.code }) };
}

const ZONE_BY_CODE: ReadonlyMap<string, string> = new Map(
  Object.values(COUNTRIES).flatMap((entry) =>
    entry.zone === undefined ? [] : [[entry.code, entry.zone] as const],
  ),
);

/** The one IANA zone of a single-zone country, or `undefined`. */
export function singleZoneOf(countryCode: string | undefined): string | undefined {
  return countryCode === undefined ? undefined : ZONE_BY_CODE.get(countryCode);
}
