import type { Logger } from 'pino';

import type { SourcesService } from '../modules/sources/service.js';
import type { Scheduler } from '../jobs/scheduler.js';
import type { JobDefinition } from '../jobs/types.js';
import type { AdapterRegistry } from '../sources/registry.js';
import { scheduledDetail } from '../sources/types.js';
import { refreshDetails, type DetailRefreshDependencies } from './detail-refresh.js';

/**
 * The scrape jobs (§4.9, ruling R22 — WP-09a is the first work package to
 * register any).
 *
 * Two kinds of job, and the difference is which resource they protect.
 *
 * `scrape:<source>` runs one source at its own cadence (D-27). One job per
 * source rather than one job that loops over them all: a source that is failing
 * must back off on its own, and a shared job would make one dead site delay
 * every other source behind it.
 *
 * `detail-refresh` is the overflow lane. A run that changed more items than its
 * request cap allowed detail fetches for leaves those records with
 * `last_fetched_at < last_seen_at`; this picks them up afterwards, so a busy
 * listing does not have to choose between the cap and completeness.
 *
 * **Registration is the intersection of the adapter registry and the enabled,
 * approved rows in `sources`.** With no adapter registered — WP-09a's state —
 * no `scrape:` job exists at all, and a source enabled by hand still cannot make
 * a request. WP-09b registers CTFtime's adapter and its job appears with no
 * wiring to add.
 */

/** How often the overflow lane looks for owed detail fetches (D-27's cycle). */
export const DETAIL_REFRESH_INTERVAL_MS = 15 * 60_000;

/** Detail fetches one `detail-refresh` pass makes per source. */
export const DETAIL_REFRESH_BATCH = 10;

export interface ScrapeJobsDependencies {
  readonly sources: SourcesService;
  readonly registry: AdapterRegistry;
  readonly runtime: DetailRefreshDependencies;
  readonly logger: Logger;
  /**
   * A10/R44: before the wizard has finished nothing may be contacted. A run
   * attempted then is not a failure of the source — on a fresh install the
   * scheduler's start-up catch-up fires while the wizard is still open — so the
   * job skips without a run row, a streak or a backoff, and setup makes it due
   * again the moment it completes ({@link scrapeJobKeys}).
   */
  readonly setupComplete?: () => boolean;
}

/** `scrape:ctftime`, `scrape:devfolio`, … */
export function scrapeJobKey(sourceKey: string): string {
  return `scrape:${sourceKey}`;
}

/** One job definition per runnable source. */
export function scrapeJobs(deps: ScrapeJobsDependencies): readonly JobDefinition[] {
  return deps.sources.runnable().map((source) => ({
    key: scrapeJobKey(source.key),
    kind: 'SCRAPE' as const,
    intervalMs: source.cadenceMinutes * 60_000,
    requiresNetwork: true,
    run: async (context) => {
      // Re-read the row: cadence, delay and `is_enabled` may have changed since
      // the job was registered, and the run must use what is true now.
      if (deps.setupComplete?.() === false) {
        return { outcome: 'SKIPPED_OFFLINE' as const, detail: 'waiting for first-run setup' };
      }
      const current = deps.sources.byKey(source.key);
      if (current?.isEnabled !== true) {
        return { outcome: 'SKIPPED_OFFLINE' as const, detail: 'the source is switched off' };
      }
      const run = await deps.sources.run(current, context.trigger, context.signal);
      if (run.outcome === 'SUCCESS') {
        return { outcome: 'SUCCESS' as const };
      }
      if (run.outcome === 'PARTIAL') {
        return { outcome: 'PARTIAL' as const, detail: run.errorKind ?? 'incomplete listing' };
      }
      if (run.outcome === 'SKIPPED_OFFLINE') {
        return { outcome: 'SKIPPED_OFFLINE' as const };
      }
      // The scrape row already holds the detail; the job row only needs to know
      // it failed, so the runner's own backoff matches the source's (R59).
      throw new Error(`${source.key}: ${run.errorKind ?? run.outcome}`);
    },
  }));
}

/**
 * The single `detail-refresh` job. Registered whether or not any adapter exists,
 * because it is one job for every source and R22 gives it to this work package.
 */
export function detailRefreshJob(deps: ScrapeJobsDependencies): JobDefinition {
  return {
    key: 'detail-refresh',
    kind: 'SCRAPE',
    intervalMs: DETAIL_REFRESH_INTERVAL_MS,
    requiresNetwork: true,
    firstRun: 'after-interval',
    run: async (context) => {
      const totals = { attempted: 0, refreshed: 0, invalid: 0, failed: 0 };
      for (const source of deps.sources.runnable()) {
        const adapter = deps.registry.get(source.key);
        if (adapter === undefined || scheduledDetail(adapter) === undefined) {
          continue;
        }
        const result = await refreshDetails(
          deps.runtime,
          source,
          adapter,
          DETAIL_REFRESH_BATCH,
          context.signal,
          context.trigger,
        );
        totals.attempted += result.attempted;
        totals.refreshed += result.refreshed;
        totals.invalid += result.invalid;
        totals.failed += result.failed;
      }
      if (totals.attempted === 0) {
        return { outcome: 'SUCCESS' as const, detail: 'nothing owed' };
      }
      deps.logger.info(totals, 'detail refresh finished');
      return {
        outcome: totals.failed > 0 ? ('PARTIAL' as const) : ('SUCCESS' as const),
        detail: `${totals.refreshed.toString()} refreshed, ${totals.failed.toString()} failed`,
      };
    },
  };
}

/** The keys of every per-source scrape job — what setup makes due when it finishes. */
export function scrapeJobKeys(deps: Pick<ScrapeJobsDependencies, 'sources'>): readonly string[] {
  return deps.sources.runnable().map((source) => scrapeJobKey(source.key));
}

/** Registers every scrape job. Called once, after the database is open. */
export function registerScrapeJobs(scheduler: Scheduler, deps: ScrapeJobsDependencies): number {
  const definitions = [...scrapeJobs(deps), detailRefreshJob(deps)];
  for (const definition of definitions) {
    scheduler.register(definition);
  }
  return definitions.length;
}
