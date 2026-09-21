import type { SourceRow } from '../db/schema/index.js';
import { APP_TIMEZONE } from '../platform/time.js';
import type { SourceRequestContext } from './http/index.js';

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

/** Everything the compliance gate needs to know about a source. */
export function sourceRequestContext(source: SourceRow): SourceRequestContext {
  return {
    key: source.key,
    name: source.name,
    complianceStatus: source.complianceStatus,
    isEnabled: source.isEnabled,
    allowedPaths: allowedPathsOf(source),
    minDelayMs: source.minDelayMs,
    maxRequestsPerRun: source.maxRequestsPerRun,
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
  return `https://${withoutWildcard}`;
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
