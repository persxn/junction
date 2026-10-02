import type { SourceRow } from '../db/schema/index.js';
import { APP_TIMEZONE } from '../platform/time.js';
import type { RobotsExemption } from '../domain/scraping/gate.js';
import type { SourceCredential, SourceRequestContext } from './http/index.js';

/**
 * Turning a `sources` row into the two shapes the rest of the pipeline wants.
 *
 * Both are small enough to inline and both are used from more than one place,
 * which is exactly the case where inlining them would let the orchestrator and
 * the admin service read the same column differently.
 */

/** `sources.config_json`, parsed, with the two keys the orchestrator reads. */
export interface ParsedSourceConfig {
  readonly raw: unknown;
  /** Detail fetches per run; the remainder continues next run (§7.2). */
  readonly detailCap: number;
  /** Zone for a source that states local times without one. */
  readonly defaultTimeZone: string;
}

/** `allowed_paths_json`, parsed. A malformed value allows nothing. */
export function allowedPathsOf(source: SourceRow): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(source.allowedPathsJson);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function configOf(source: SourceRow): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(source.configJson);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * `config_json.robotsExemption`, when it is well-formed (WP-11). Seed-only: the
 * admin API has no field that writes `config_json`.
 */
export function robotsExemptionOf(source: SourceRow): RobotsExemption | undefined {
  const raw = configOf(source).robotsExemption as Partial<RobotsExemption> | undefined;
  if (
    raw === undefined ||
    !Array.isArray(raw.paths) ||
    typeof raw.reason !== 'string' ||
    typeof raw.reviewedBy !== 'string' ||
    typeof raw.reviewedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    paths: raw.paths.filter((entry): entry is string => typeof entry === 'string'),
    reason: raw.reason,
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
  };
}

/**
 * What to record when a source that needs a credential has none (WP-11): the
 * `config_json.auth.missingDetail` sentence, or `undefined` for a source that
 * needs no credential at all.
 */
export function missingCredentialDetail(source: SourceRow): string | undefined {
  const auth = configOf(source).auth as { missingDetail?: unknown } | undefined;
  if (auth === undefined || auth === null) {
    return undefined;
  }
  return typeof auth.missingDetail === 'string' && auth.missingDetail.length > 0
    ? auth.missingDetail
    : `${source.name} API credential not set`;
}

/**
 * Everything the compliance gate needs to know about a source.
 *
 * `credential` is whichever one the source holds. R75 is why its kind matters
 * here: an API key goes into `credential` and rides on every request, while the
 * professor's session goes into `session` and rides only on a request granted
 * `signed-in`.
 */
export function sourceRequestContext(
  source: SourceRow,
  credential?: SourceCredential,
): SourceRequestContext {
  const isSession = credential?.kind === 'SESSION';
  return {
    key: source.key,
    name: source.name,
    complianceStatus: source.complianceStatus,
    isEnabled: source.isEnabled,
    allowedPaths: allowedPathsOf(source),
    minDelayMs: source.minDelayMs,
    maxRequestsPerRun: source.maxRequestsPerRun,
    credential: isSession ? undefined : credential,
    session: isSession ? credential : undefined,
    robotsExemption: robotsExemptionOf(source),
  };
}

/**
 * A URL that stands for the source, so the gate can be asked about the source as
 * a whole before a run opens.
 *
 * It comes from the first allow entry in `allowed_paths_json`, which is the only
 * place that says where this source actually lives. A source with no entries —
 * every MANUAL_IMPORT_ONLY row — gets a URL that matches nothing, and is refused
 * whichever question the gate reaches first.
 */
export function representativeUrl(source: SourceRow): string {
  const entry = allowedPathsOf(source).find((candidate) => !candidate.startsWith('!'));
  if (entry === undefined) {
    return 'https://unconfigured.invalid/';
  }
  const withoutWildcard = entry.startsWith('*.') ? entry.slice(2) : entry;
  // An end anchor is grammar, not path.
  const withoutAnchor = withoutWildcard.endsWith('$')
    ? withoutWildcard.slice(0, -1)
    : withoutWildcard;
  return `https://${withoutAnchor}`;
}

/** How many detail fetches one run may make when the source does not say. */
export const DEFAULT_DETAIL_CAP = 10;

/** §6.2's `config_json`, with the two settings this file reads. */
export function sourceConfig(source: SourceRow): ParsedSourceConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(source.configJson);
  } catch {
    raw = {};
  }
  const record = (raw ?? {}) as { maxDetailsPerRun?: unknown; defaultTimeZone?: unknown };
  const cap = record.maxDetailsPerRun;
  const zone = record.defaultTimeZone;
  return {
    raw: raw ?? {},
    detailCap: typeof cap === 'number' && cap >= 0 ? Math.trunc(cap) : DEFAULT_DETAIL_CAP,
    defaultTimeZone: typeof zone === 'string' && zone.length > 0 ? zone : APP_TIMEZONE,
  };
}
