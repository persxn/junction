import type { Logger } from 'pino';

import { systemClock, type Clock } from '../../platform/time.js';
import type { ValidatorStore } from './cache.js';
import { PoliteHttpClient, type HttpEnvironment, type RequestBudget } from './polite-client.js';
import { HostQueue } from './queue.js';
import { RobotsCache } from './robots.js';
import { realSleeper, type Fetcher, type Sleeper, type SourceRequestContext } from './types.js';

/**
 * The process-wide half of the scraping HTTP layer.
 *
 * The robots cache, the per-host politeness queue and the reachability answers
 * are shared across every source and every run — they are facts about somebody
 * else's server, and two runs that each kept their own copy would be twice as
 * impolite as one. The request budget is not shared, which is why
 * {@link ScrapingHttp.clientFor} hands out a fresh {@link PoliteHttpClient} per
 * run.
 *
 * Nothing here reaches the network by itself: the transport arrives as a
 * `Fetcher`, and `main.ts` is the only caller that passes the real one.
 */

/** Longest a single `Retry-After` wait may be before a run gives up (§7.2). */
export const DEFAULT_MAX_WAIT_MS = 5 * 60_000;

export interface ScrapingHttpOptions {
  readonly fetcher: Fetcher;
  readonly logger: Logger;
  /** Absent in tests that do not care about conditional GETs. */
  readonly cache?: ValidatorStore;
  readonly clock?: Clock;
  readonly sleep?: Sleeper;
  readonly random?: () => number;
  /** `APP_VERSION`; goes into the User-Agent (§7.2). */
  readonly appVersion: string;
  /** `settings.scraper.contactEmail`, read at request time (A10/R44). */
  readonly contactEmail: () => string;
  /** False while the R39 setup gate is still closed. */
  readonly setupComplete: () => boolean;
  /** R23's interface-table check; injected so tests can be "offline". */
  readonly hasNetworkInterface: () => boolean;
  readonly maxWaitMs?: number;
}

export class ScrapingHttp {
  readonly #env: HttpEnvironment;
  readonly #maxWaitMs: number;

  constructor(options: ScrapingHttpOptions) {
    const clock = options.clock ?? systemClock;
    const sleep = options.sleep ?? realSleeper;
    const queue = new HostQueue({ clock, sleep });
    const userAgent = (): string => {
      const email = options.contactEmail().trim();
      return `Junction/${options.appVersion} (+mailto:${email})`;
    };
    this.#maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.#env = {
      fetcher: options.fetcher,
      queue,
      robots: new RobotsCache({
        fetcher: options.fetcher,
        queue,
        clock,
        logger: options.logger,
        userAgent,
      }),
      cache: options.cache,
      clock,
      sleep,
      logger: options.logger,
      random: options.random ?? Math.random,
      userAgent,
      // A10/R44 in one predicate: the wizard has finished *and* left an address
      // to identify us by. Either one missing means no request is made at all.
      setupComplete: () => options.setupComplete() && options.contactEmail().trim().length > 0,
      hasNetworkInterface: options.hasNetworkInterface,
      reachability: new Map(),
    };
  }

  /** The User-Agent as it would be sent right now. Used by tests and diagnostics. */
  userAgent(): string {
    return this.#env.userAgent();
  }

  /** How many robots.txt files have been fetched since start. */
  get robotsFetches(): number {
    return this.#env.robots.fetches;
  }

  /** Forgets every cached robots.txt and reachability answer. */
  reset(): void {
    this.#env.robots.clear();
    this.#env.reachability.clear();
  }

  /**
   * A client for one run of one source. The budget comes from the source row, so
   * `max_requests_per_run` is enforced by the object the adapter holds rather
   * than by the orchestrator remembering to count.
   */
  clientFor(
    source: SourceRequestContext,
    signal: AbortSignal,
    budget?: Partial<RequestBudget>,
  ): PoliteHttpClient {
    return new PoliteHttpClient(
      this.#env,
      source,
      {
        maxRequests: budget?.maxRequests ?? source.maxRequestsPerRun,
        maxWaitMs: budget?.maxWaitMs ?? this.#maxWaitMs,
      },
      signal,
    );
  }
}
