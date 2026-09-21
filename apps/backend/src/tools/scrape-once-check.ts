import { SCRAPEABLE_COMPLIANCE_STATUSES } from '@compintel/contracts';

import type { SourceRow, SourceStateRow } from '../db/schema/index.js';
import { nextManualRefreshAt } from '../modules/sources/mappers.js';
import type { AdapterRegistry } from '../sources/registry.js';

/**
 * The refusals `pnpm scrape:once` makes before it opens a socket (WP-09b).
 * Pure, so they are tested without a network or a data directory.
 */

/** `--source <key>` from the script's own arguments. */
export function parseSourceArg(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--source');
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') || value.length === 0 ? undefined : value;
}

/**
 * Why this source may not be run once by hand right now, or `undefined`.
 *
 * Only APPROVED and APPROVED_WITH_LIMITS sources run, only enabled ones, only
 * those with an adapter, and never inside the manual floor (D-27): the floor
 * protects the source's server, and a developer at a terminal costs it exactly
 * as much as an administrator pressing Refresh.
 */
export function scrapeOnceRefusal(
  source: SourceRow | undefined,
  state: SourceStateRow | undefined,
  registry: AdapterRegistry,
  now: number,
): string | undefined {
  if (source === undefined) {
    return 'No such source.';
  }
  if (!SCRAPEABLE_COMPLIANCE_STATUSES.includes(source.complianceStatus)) {
    return `${source.key} is ${source.complianceStatus}; only APPROVED or APPROVED_WITH_LIMITS sources may run.`;
  }
  if (!source.isEnabled) {
    return `${source.key} is disabled.`;
  }
  if (!registry.has(source.key)) {
    return `${source.key} has no adapter in this build.`;
  }
  const allowedAt = state === undefined ? null : nextManualRefreshAt(source, state);
  if (allowedAt !== null && allowedAt > now) {
    return `${source.key} ran less than ${String(source.manualMinIntervalMinutes)} minutes ago; try after ${new Date(allowedAt).toISOString()}.`;
  }
  return undefined;
}
