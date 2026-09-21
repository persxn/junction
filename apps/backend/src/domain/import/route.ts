import type { ComplianceStatus, ImportDisposition } from '@compintel/contracts';

import { normalizeUrl } from '../normalize/urls.js';

/**
 * Where a pasted link goes, decided before anything touches the network
 * (§7.1's URL-import bullet, D-30, WP-14).
 *
 * Pure, and deliberately so: "was a request made to Devpost?" is a question the
 * tests have to be able to answer with certainty, and a decision that cannot
 * make a request is the only kind that can be certain. The service asks this
 * first and does what it says.
 *
 * The table it decides against is built from the live `sources` rows, never from
 * a second hard-coded list here — so WP-13's verdict for Unstop and D-26's for
 * Devpost apply the moment a migration changes them.
 */

/** One `sources` row, as the dispatcher needs to see it. */
export interface ImportSource {
  readonly key: string;
  readonly name: string;
  readonly complianceStatus: ComplianceStatus;
  readonly isEnabled: boolean;
  /** `config_json.hosts`: `devfolio.co`, `*.devfolio.co`. */
  readonly hosts: readonly string[];
  /** Whether the registered adapter has a `detail()` step to read one page with. */
  readonly canDetail: boolean;
  /** `compliance_notes` — what the UI tells the professor, in the source's words. */
  readonly complianceNotes: string;
}

export type ImportRoute =
  | { readonly disposition: 'ADAPTER'; readonly url: string; readonly source: ImportSource }
  | {
      readonly disposition: 'MANUAL_ONLY';
      readonly url: string;
      readonly source: ImportSource;
      readonly reason: string;
    }
  | { readonly disposition: 'GENERIC'; readonly url: string }
  | { readonly disposition: 'INVALID'; readonly reason: string };

/** Dispositions that reach the network. `MANUAL_ONLY` is not one of them. */
export const FETCHING_DISPOSITIONS: readonly ImportDisposition[] = ['ADAPTER', 'GENERIC'];

/** Suffixes whose last two labels are not a registrable domain (`iitb.ac.in`). */
const MULTI_LABEL_SUFFIXES: readonly string[] = [
  'ac.in',
  'co.in',
  'edu.in',
  'gov.in',
  'net.in',
  'org.in',
  'res.in',
  'co.uk',
  'ac.uk',
  'org.uk',
  'com.au',
  'edu.au',
  'co.jp',
  'com.br',
  'com.sg',
];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The registrable parent of a host — `devfolio.co` for `hack.devfolio.co`.
 *
 * Approximated from the last two labels, with a short list of two-label public
 * suffixes so `cse.iitb.ac.in` gives `iitb.ac.in` rather than `ac.in`. A full
 * public-suffix list is a dependency and a monthly update for a decision whose
 * worst case is that a campus URL takes the generic path it was going to take
 * anyway.
 */
export function registrableParent(host: string): string | undefined {
  const labels = host.split('.');
  if (labels.length < 3) {
    return undefined;
  }
  const suffix = MULTI_LABEL_SUFFIXES.find((candidate) => host.endsWith(`.${candidate}`));
  const keep = suffix === undefined ? 2 : suffix.split('.').length + 1;
  return labels.length <= keep ? undefined : labels.slice(-keep).join('.');
}

/** Whether a host is covered by one `config_json.hosts` entry. */
export function hostMatches(host: string, pattern: string): boolean {
  const wanted = pattern.trim().toLowerCase().replace(/^!/, '');
  if (wanted.length === 0) {
    return false;
  }
  if (wanted.startsWith('*.')) {
    const base = wanted.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === wanted;
}

/**
 * The URL as everything downstream will see it: https only, lower-case host, no
 * `www.`, no tracking parameters, no fragment.
 *
 * `www.` is dropped because the same page is reachable with and without it and
 * §7.5 matches events on an identical normalized URL — two spellings of one page
 * would import as two events. Everything else about the path is left exactly as
 * it was: plenty of servers care about its case.
 */
export function normalizeImportUrl(raw: string): string | undefined {
  const normalized = normalizeUrl(raw);
  if (normalized === undefined) {
    return undefined;
  }
  const url = new URL(normalized);
  if (url.protocol !== 'https:') {
    return undefined;
  }
  // An IP literal names a machine, not a site with a robots.txt and a policy.
  if (IPV4.test(url.hostname) || url.hostname.startsWith('[')) {
    return undefined;
  }
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
  }
  if (url.username !== '' || url.password !== '') {
    return undefined;
  }
  return url.toString().replace(/\?$/, '');
}

/** Statuses that may be read automatically at all (§7.2's gate, first line). */
const SCRAPEABLE: readonly ComplianceStatus[] = ['APPROVED', 'APPROVED_WITH_LIMITS'];

/** The sentence the MANUAL_ONLY banner shows, in the source's own words. */
function manualReason(source: ImportSource): string {
  const notes = source.complianceNotes.trim();
  let lead: string;
  if (source.complianceStatus === 'BLOCKED') {
    lead = `${source.name} is blocked, so nothing was requested from it. Type the details in — the link is saved with the event.`;
  } else if (!SCRAPEABLE.includes(source.complianceStatus)) {
    lead = `${source.name} doesn't allow automated reading, so type the details in. The link is saved with the event.`;
  } else if (!source.isEnabled) {
    lead = `${source.name} is switched off, so nothing was requested from it. Type the details in — the link is saved with the event.`;
  } else {
    lead = `${source.name} can't be read one page at a time, so type the details in. The link is saved with the event.`;
  }
  return notes.length === 0 ? lead : `${lead} ${notes}`;
}

/**
 * Which path a URL takes.
 *
 * The order is the point. A URL that is not one we will follow is refused before
 * any table is consulted; a domain that belongs to a source is decided by that
 * source's verdict, whether or not we have an adapter for it; and only a domain
 * no source claims reaches the generic extractor.
 */
export function resolveImportRoute(raw: string, sources: readonly ImportSource[]): ImportRoute {
  const url = normalizeImportUrl(raw);
  if (url === undefined) {
    return {
      disposition: 'INVALID',
      reason:
        'That is not a link this can import: it has to be an https:// address of a web page, not an IP address or a file.',
    };
  }
  const host = new URL(url).hostname;
  const parent = registrableParent(host);
  const source = sources.find((candidate) =>
    candidate.hosts.some(
      (pattern) =>
        hostMatches(host, pattern) || (parent !== undefined && hostMatches(parent, pattern)),
    ),
  );
  if (source === undefined) {
    return { disposition: 'GENERIC', url };
  }
  // A source we may not read automatically is never requested — not the page,
  // not even its robots.txt (D-30). The verdict is the whole decision.
  if (!SCRAPEABLE.includes(source.complianceStatus) || !source.isEnabled || !source.canDetail) {
    return { disposition: 'MANUAL_ONLY', url, source, reason: manualReason(source) };
  }
  return { disposition: 'ADAPTER', url, source };
}
