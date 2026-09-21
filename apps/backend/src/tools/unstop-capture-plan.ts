import { unstopListingUrl } from '../adapters/unstop/adapter.js';
import { redact } from '../domain/normalize/index.js';
import { UNSTOP_ORIGIN } from '../domain/unstop/map.js';

/**
 * The pure half of `pnpm unstop:capture` (WP-13 step 4): what the capture asks
 * for, what it is allowed to write, and what the answers say about R71.
 *
 * Kept apart from the tool itself so the request plan, the scrubber and the
 * verdict are tested offline — the capture makes real requests to a real site,
 * so it has to be readable before it is ever run.
 */

/** The same defaults `configOf()` gives the adapter; a capture must match a run. */
export const CAPTURE_CONFIG = {
  listingPath: '/api/public/opportunity/search-result',
  opportunities: ['hackathons', 'competitions'],
  perPage: 30,
  detailPath: '/api/public/competition/',
};

/** WP-13 step 4: "≤ 4 requests total" — two listings and two details. */
export const CAPTURE_BUDGET = 4;

export interface PlannedRequest {
  /** The fixture's base name; `.json` and `.meta.json` are written beside it. */
  readonly name: string;
  readonly url: string;
}

/** One first page per opportunity type. Never page 2: the capture is a sample. */
export function plannedListings(): PlannedRequest[] {
  return CAPTURE_CONFIG.opportunities.map((opportunity) => ({
    name: `listing-${opportunity}-p1`,
    url: unstopListingUrl(CAPTURE_CONFIG, opportunity, 1),
  }));
}

/** The detail for one listed opportunity, by the id the listing carried. */
export function plannedDetail(id: number): PlannedRequest {
  return {
    name: `detail-${String(id)}`,
    url: new URL(`${CAPTURE_CONFIG.detailPath}${String(id)}`, UNSTOP_ORIGIN).toString(),
  };
}

/**
 * Keys whose values are people (D-29): organiser and registrant contacts,
 * profiles, socials. They are nulled rather than deleted, so the committed
 * fixture keeps the shape the live payload had and the schema assertions stay
 * honest.
 */
const PERSON_KEY: readonly RegExp[] = [
  /mail/i,
  /phone/i,
  /mobile/i,
  /whatsapp/i,
  /contact/i,
  /^users?$/i,
  /^registered_users?$/i,
  /^participants?$/i,
  /^members?$/i,
  /^mentors?$/i,
  /^speakers?$/i,
  /^judges?$/i,
  /^jury$/i,
  /^author$/i,
  /^owner$/i,
  /^organiser/i,
  /^organizer/i,
  /^poc/i,
  /^profile/i,
  /^social/i,
  /_by$/i,
];

/**
 * The keys the schema reads (R71). Nulling one would fail a real capture with
 * `SCHEMA_CHANGED` for a reason the site had nothing to do with, so the
 * scrubber never touches them — none of them holds a person.
 */
const KEEP: ReadonlySet<string> = new Set([
  'data',
  'current_page',
  'last_page',
  'competition',
  'id',
  'title',
  'type',
  'subtype',
  'public_url',
  'organisation',
  'name',
  'start_date',
  'end_date',
  'regnRequirements',
  'start_regn_dt',
  'end_regn_dt',
  'min_team_size',
  'max_team_size',
  'region',
  'address_with_country_logo',
  'city',
  'state',
  'country',
  'isPaid',
  'prizes',
  'rank',
  'cash',
  'currency',
  'others',
  'filters',
  'details',
]);

export interface Scrubbed {
  readonly value: unknown;
  /** Paths that were nulled or redacted, for the fixture's `.meta.json`. */
  readonly redacted: readonly string[];
}

function isPerson(key: string): boolean {
  return !KEEP.has(key) && PERSON_KEY.some((pattern) => pattern.test(key));
}

/**
 * A captured payload with its personal data removed: people-shaped keys nulled,
 * e-mails and phone numbers inside the strings that stay replaced by WP-08a's
 * redactor. Structure, ordering and every other value are left as they came.
 */
export function scrubFixture(value: unknown): Scrubbed {
  const redacted: string[] = [];
  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') {
      const cleaned = redact(node);
      if (cleaned !== node) {
        redacted.push(path);
      }
      return cleaned;
    }
    if (Array.isArray(node)) {
      return node.map((entry, index) => walk(entry, `${path}[${String(index)}]`));
    }
    if (node === null || typeof node !== 'object') {
      return node;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(node)) {
      const here = `${path}.${key}`;
      if (isPerson(key)) {
        out[key] = null;
        redacted.push(here);
      } else {
        out[key] = walk(inner, here);
      }
    }
    return out;
  };
  return { value: walk(value, '$'), redacted };
}

export interface Observation {
  readonly url: string;
  readonly at: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly bytes: number;
  /** Whether the body still parses as the schema the adapter validates. */
  readonly schemaMatched: boolean;
  /** `retry-after`, `x-ratelimit-*` and friends, as the response carried them. */
  readonly rateLimitHeaders: Readonly<Record<string, string>>;
}

export interface CaptureMeta {
  readonly synthetic: false;
  readonly captured: true;
  readonly url: string;
  readonly timestamp: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly bytes: number;
  readonly redacted: readonly string[];
  readonly note: string;
}

const META_NOTE =
  'Captured by `pnpm --filter @compintel/backend unstop:capture` (WP-13 step 4). People-shaped keys are nulled and contact details redacted (D-29); nothing else is changed.';

export function captureMeta(observation: Observation, redacted: readonly string[]): CaptureMeta {
  return {
    synthetic: false,
    captured: true,
    url: observation.url,
    timestamp: observation.at,
    status: observation.status,
    contentType: observation.contentType,
    bytes: observation.bytes,
    redacted,
    note: META_NOTE,
  };
}

export interface Verdict {
  /** True when every answer was public, JSON, and shaped as the adapter expects. */
  readonly holds: boolean;
  readonly findings: readonly string[];
}

/**
 * What the capture says about R71's assumption that `/api/public/*` is an
 * unauthenticated, robots-allowed, stable-enough public endpoint. A `false`
 * here changes the ruling, not only the code — it belongs in the report.
 */
export function r71Verdict(observations: readonly Observation[]): Verdict {
  if (observations.length === 0) {
    return { holds: false, findings: ['No request was made.'] };
  }
  const findings: string[] = [];
  for (const observation of observations) {
    if (observation.status === 401 || observation.status === 403) {
      findings.push(
        `${observation.url} answered ${String(observation.status)}: not public to an unauthenticated reader.`,
      );
    } else if (observation.status === 404) {
      findings.push(`${observation.url} answered 404: absent at that path.`);
    } else if (observation.status === 429) {
      findings.push(`${observation.url} answered 429: rate-limited beyond the robots hints.`);
    } else if (observation.status >= 400) {
      findings.push(`${observation.url} answered ${String(observation.status)}.`);
    } else if (observation.contentType !== null && !observation.contentType.includes('json')) {
      findings.push(`${observation.url} answered ${observation.contentType}, not JSON.`);
    } else if (!observation.schemaMatched) {
      findings.push(
        `${observation.url} is JSON but does not match the schema the adapter validates: the synthetic fixtures were wrong.`,
      );
    }
    const limits = Object.keys(observation.rateLimitHeaders);
    if (limits.length > 0) {
      findings.push(`${observation.url} carried rate-limit headers: ${limits.join(', ')}.`);
    }
  }
  return { holds: findings.length === 0, findings };
}
