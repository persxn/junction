import type { EventMode, EventType, RegState } from '@compintel/contracts';

/**
 * The words the Discover screen uses for enum values. They match the facet
 * labels the backend sends (`modules/search/domain/facets.ts`), so a chip and
 * its count never name the same thing two ways.
 */

export const EVENT_TYPE_LABELS: Readonly<Record<EventType, string>> = {
  HACKATHON: 'Hackathon',
  IDEATHON: 'Ideathon',
  INNOVATION_CHALLENGE: 'Innovation challenge',
  CTF: 'CTF',
  CODING_CONTEST: 'Coding contest',
  OTHER: 'Other',
};

export const MODE_LABELS: Readonly<Record<EventMode, string>> = {
  ONLINE: 'Online',
  OFFLINE: 'In person',
  HYBRID: 'Hybrid',
  UNKNOWN: 'Mode unknown',
};

export const REG_STATE_LABELS: Readonly<Record<RegState, string>> = {
  NOT_OPEN: 'Not open yet',
  OPEN: 'Open',
  CLOSING_SOON: 'Closing soon',
  CLOSED: 'Closed',
  UNKNOWN: 'Deadline unknown',
};

/** Source keys as a person reads them (the icons' accessible names). */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  ctftime: 'CTFtime',
  clist: 'CLIST',
  devfolio: 'Devfolio',
  unstop: 'Unstop',
  devpost: 'Devpost',
  manual: 'Added by hand',
  'url-import': 'Imported from a link',
  url_import: 'Imported from a link',
};

export function sourceName(key: string): string {
  return SOURCE_NAMES[key] ?? key;
}
