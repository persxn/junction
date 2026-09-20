import type { Logger } from 'pino';
import robotsParserImport from 'robots-parser';

import type { RobotsVerdict } from '../../domain/scraping/gate.js';
import type { Clock } from '../../platform/time.js';
import { asTransportError } from './classify.js';
import { hostKey } from './queue.js';
import type { HostQueue } from './queue.js';
import { decode, readCapped } from './read.js';
import { CONNECT_TIMEOUT_MS, ROBOTS_TTL_MS, TOTAL_TIMEOUT_MS, type Fetcher } from './types.js';

/**
 * robots.txt, fetched once per host and trusted for 24 hours (§7.2, ADR-0007).
 *
 * **Per host, not per site.** Devfolio gives every hackathon its own sub-domain,
 * each serving its own robots.txt, so `devfolio.co` and `recursiveacm.devfolio.co`
 * are two entries. The cache key is scheme + host + port, the same key the
 * politeness queue uses.
 *
 * What a failed fetch means is the part worth stating. A 404 or a 5xx means the
 * host published no rules, and no rules means no restriction — that is the
 * standard reading and it is what the spec says. A fetch that *failed to
 * complete* — timed out, could not resolve, presented a bad certificate — is
 * different: we do not have the host's answer, so for the rest of the run that
 * host is disallowed. Guessing "probably fine" about somebody else's server is
 * exactly the thing §7.2 forbids.
 *
 * robots.txt fetches are counted separately from `max_requests_per_run`. That
 * cap is the adapter's budget and `requests_made` is what an administrator reads
 * next to it; a precondition that happens at most once per host per day would
 * only make the two incomparable. The count is in the run's log line instead.
 */

/** Robots bodies are small; anything larger is a misconfigured server. */
const MAX_ROBOTS_BYTES = 512 * 1024;

/**
 * The product token robots.txt rules are matched against. The full User-Agent
 * carries a version and a contact address (A10), neither of which belongs in a
 * `User-agent:` comparison.
 */
export const ROBOTS_USER_AGENT = 'CompIntel';

export interface RobotsLookup {
  readonly verdict: RobotsVerdict;
  /** `Crawl-delay` in seconds, when the host stated one (A9). */
  readonly crawlDelaySeconds: number | undefined;
  /** True when this host could not be asked; the caller disallows it this run. */
  readonly unreachable: boolean;
}

interface CacheEntry {
  readonly fetchedAt: number;
  readonly isAllowed: (url: string) => boolean;
  readonly crawlDelaySeconds: number | undefined;
}

export interface RobotsCacheOptions {
  readonly fetcher: Fetcher;
  readonly queue: HostQueue;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The full `CompIntel/<version> (+mailto:…)` string, sent as a header. */
  readonly userAgent: () => string;
}

/** Everything allowed, which is what "no rules" means. */
const NO_RULES: Omit<CacheEntry, 'fetchedAt'> = {
  isAllowed: () => true,
  crawlDelaySeconds: undefined,
};

export class RobotsCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<CacheEntry | undefined>>();
  readonly #options: RobotsCacheOptions;
  /** How many robots.txt requests have been made; the run's log line reports it. */
  #fetches = 0;

  constructor(options: RobotsCacheOptions) {
    this.#options = options;
  }

  get fetches(): number {
    return this.#fetches;
  }

  /** Drops every cached answer. Only tests and an admin "re-check" use it. */
  clear(): void {
    this.#entries.clear();
  }

  /**
   * What robots.txt on this URL's host says about it, fetching and caching the
   * file if the last copy is missing or older than 24 hours.
   *
   * `delayMs` is the effective delay *before* the crawl-delay is known — the
   * 3-second floor and the source's own setting — because the file that would
   * tell us otherwise is the one being fetched.
   */
  async lookup(url: URL, delayMs: number, signal?: AbortSignal): Promise<RobotsLookup> {
    const key = hostKey(url);
    const cached = this.#entries.get(key);
    const now = this.#options.clock.now().getTime();
    if (cached !== undefined && now - cached.fetchedAt < ROBOTS_TTL_MS) {
      return this.#verdict(cached, url);
    }

    // Two adapters asking about the same host at once fetch it once.
    const pending = this.#inFlight.get(key) ?? this.#fetch(key, delayMs, signal);
    this.#inFlight.set(key, pending);
    let entry: CacheEntry | undefined;
    try {
      entry = await pending;
    } finally {
      this.#inFlight.delete(key);
    }
    if (entry === undefined) {
      return { verdict: 'DISALLOWED', crawlDelaySeconds: undefined, unreachable: true };
    }
    this.#entries.set(key, entry);
    return this.#verdict(entry, url);
  }

  #verdict(entry: CacheEntry, url: URL): RobotsLookup {
    return {
      verdict: entry.isAllowed(url.toString()) ? 'ALLOWED' : 'DISALLOWED',
      crawlDelaySeconds: entry.crawlDelaySeconds,
      unreachable: false,
    };
  }

  /** Returns undefined when the host could not be asked at all. */
  async #fetch(
    key: string,
    delayMs: number,
    signal?: AbortSignal,
  ): Promise<CacheEntry | undefined> {
    const robotsUrl = `${key}/robots.txt`;
    const fetchedAt = this.#options.clock.now().getTime();
    try {
      return await this.#options.queue.run(
        key,
        delayMs,
        async () => {
          this.#fetches += 1;
          const response = await this.#options.fetcher({
            url: robotsUrl,
            method: 'GET',
            headers: { 'user-agent': this.#options.userAgent(), accept: 'text/plain,*/*' },
            signal: signal ?? new AbortController().signal,
            connectTimeoutMs: CONNECT_TIMEOUT_MS,
            totalTimeoutMs: TOTAL_TIMEOUT_MS,
          });
          if (response.status !== 200) {
            // 404, 410, 5xx, a redirect we did not follow: no rules published.
            await readCapped(response, MAX_ROBOTS_BYTES).catch(() => undefined);
            this.#options.logger.debug(
              { host: key, status: response.status },
              'robots.txt published no rules',
            );
            return { fetchedAt, ...NO_RULES };
          }
          const { body } = await readCapped(response, MAX_ROBOTS_BYTES);
          return parseRobots(robotsUrl, decode(body), fetchedAt);
        },
        signal,
      );
    } catch (error) {
      const kind = asTransportError(error).kind;
      this.#options.logger.warn(
        { host: key, kind },
        'robots.txt could not be read; this host is skipped for the rest of the run',
      );
      return undefined;
    }
  }
}

/** The two members of `robots-parser`'s `Robot` this file uses. */
interface ParsedRobots {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
}

/**
 * `robots-parser` is CommonJS with a bare `module.exports = fn`, and its
 * declaration file opens with `declare module 'robots-parser';`, which makes
 * TypeScript type the default import as the module namespace rather than as the
 * function it actually is at run time. The cast fixes the type; the import stays
 * a static one so esbuild inlines the package into the bundle, which
 * `createRequire` would not have done — the packaged backend runs from a folder
 * with no `node_modules` above it (R17).
 */
const robotsParser = robotsParserImport as unknown as (
  url: string,
  contents: string,
) => ParsedRobots;

/** Exported for the test that parses the committed `ctftime.org.txt` fixture. */
export function parseRobots(robotsUrl: string, body: string, fetchedAt: number): CacheEntry {
  const parsed = robotsParser(robotsUrl, body);
  return {
    fetchedAt,
    // `isAllowed` answers `undefined` for a URL on another host; treating that
    // as allowed is correct, because these rules simply do not govern it.
    isAllowed: (target: string) => parsed.isAllowed(target, ROBOTS_USER_AGENT) !== false,
    crawlDelaySeconds: parsed.getCrawlDelay(ROBOTS_USER_AGENT),
  };
}
