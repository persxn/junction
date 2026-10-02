import type { ScrapeMethod } from '@compintel/contracts';
import type { Logger } from 'pino';

import { assessRequest, effectiveDelayMs, refusalErrorKind } from '../../domain/scraping/gate.js';
import type { RobotsVerdict } from '../../domain/scraping/gate.js';
import type { Clock } from '../../platform/time.js';
import { credentialRefused, grantSignedIn, retryDelay, statusError } from './attempt-rules.js';
import type { ValidatorStore } from './cache.js';
import { asTransportError, isLoginRedirect } from './classify.js';
import { hostKey } from './queue.js';
import type { HostQueue } from './queue.js';
import { probeReachability } from './reachability.js';
import { notModifiedResponse, requestHeaders, storedResponse } from './read.js';
import type { RobotsCache } from './robots.js';
import { newRunLedger, type RunLedger } from './run-ledger.js';
import {
  CONNECT_TIMEOUT_MS,
  MAX_RETRIES,
  ScrapeRequestError,
  TOTAL_TIMEOUT_MS,
  type Fetcher,
  type PoliteResponse,
  type RequestOptions,
  type Sleeper,
  type SourceRequestContext,
  type TransportResponse,
} from './types.js';

/**
 * The `PoliteHttpClient` of §4.8 and §7.2 — one per scrape run, because the
 * request budget is per run.
 *
 * Every request passes the compliance gate twice: once before robots.txt is
 * known, to answer the questions that do not need it, and once after. Then it
 * goes through the per-host queue, which enforces the effective delay and the
 * one-in-flight rule. Only then is a socket opened, and only through the
 * injected `Fetcher`.
 *
 * The retry rules are §7.2's: a 403 is answered once, same User-Agent,
 * `BLOCKED` (R60); TLS is never worked around; 429/503 honour `Retry-After`
 * when it fits in the run. A refused credential is R80's (`#rejected`).
 *
 * R75 is enforced here, not trusted to the adapter: a request is `anonymous`
 * unless it asks for `signed-in` *and* is made on a view the orchestrator
 * opened for targeted reading ({@link PoliteHttpClient.signedInView}).
 */

/** What the client is allowed to spend on one run. */
export interface RequestBudget {
  readonly maxRequests: number;
  /** Longest single `Retry-After` wait the run will sit through (§7.2). */
  readonly maxWaitMs: number;
}

/** The process-wide machinery a per-run client borrows. */
export interface HttpEnvironment {
  readonly fetcher: Fetcher;
  readonly queue: HostQueue;
  readonly robots: RobotsCache;
  readonly cache: ValidatorStore | undefined;
  readonly clock: Clock;
  readonly sleep: Sleeper;
  readonly logger: Logger;
  readonly random: () => number;
  /** `CompIntel/<version> (+mailto:…)`, read at request time (A10). */
  readonly userAgent: () => string;
  /** False until the wizard has finished *and* recorded a contact address. */
  readonly setupComplete: () => boolean;
  /** R23's interface-table check: no network call. */
  readonly hasNetworkInterface: () => boolean;
  /** R61: shared across runs so a probe happens at most once per 5 minutes. */
  readonly reachability: Map<string, { at: number; reachable: boolean }>;
}

export class PoliteHttpClient {
  readonly #env: HttpEnvironment;
  readonly #source: SourceRequestContext;
  readonly #budget: RequestBudget;
  readonly #signal: AbortSignal;
  readonly #ledger: RunLedger;
  /** R75: whether a `signed-in` request made on this view may carry the session. */
  readonly #signedInScope: boolean;

  constructor(
    env: HttpEnvironment,
    source: SourceRequestContext,
    budget: RequestBudget,
    signal: AbortSignal,
    ledger: RunLedger = newRunLedger(),
    signedInScope = false,
  ) {
    this.#env = env;
    this.#source = source;
    this.#budget = budget;
    this.#signal = signal;
    this.#ledger = ledger;
    this.#signedInScope = signedInScope;
  }

  /**
   * The same run, seen through a view that may read signed in (R75) — or, with
   * `false`, one that may not. It shares this client's budget, its signed-in
   * count and its robots answers; only the scope differs.
   *
   * The orchestrator opens one for the detail page of an event already stored,
   * outside a catch-up burst, and for nothing else.
   */
  signedInView(allowed = true): PoliteHttpClient {
    return new PoliteHttpClient(
      this.#env,
      this.#source,
      this.#budget,
      this.#signal,
      this.#ledger,
      allowed,
    );
  }

  /** Requests the adapter has made; this is what `scrape_runs.requests_made` records. */
  get requestsMade(): number {
    return this.#ledger.requestsMade;
  }

  /** R75: requests that carried the professor's session. */
  get signedInRequestsMade(): number {
    return this.#ledger.signedInMade;
  }

  /** R80: the site refused the session during this run. */
  get sessionRejected(): boolean {
    return this.#ledger.sessionRejected;
  }

  get requestsRemaining(): number {
    return Math.max(0, this.#budget.maxRequests - this.#ledger.requestsMade);
  }

  get(url: string, options: RequestOptions = {}): Promise<PoliteResponse> {
    return this.#request(url, 'GET', options);
  }

  head(url: string, options: RequestOptions = {}): Promise<PoliteResponse> {
    return this.#request(url, 'HEAD', options);
  }

  /**
   * R23's cheap first answer: does this machine have a usable network interface?
   * No packet is sent, so a laptop on a train answers instantly and its runs are
   * `SKIPPED_OFFLINE` rather than a failure streak (D-23).
   */
  isOnline(): boolean {
    return this.#env.hasNetworkInterface();
  }

  /** R61's confirming probe; see `reachability.ts`. */
  isReachable(url: string): Promise<boolean> {
    return probeReachability(this.#env, url, this.isOnline(), (target) => this.head(target));
  }

  async #request(
    rawUrl: string,
    method: ScrapeMethod,
    options: RequestOptions,
  ): Promise<PoliteResponse> {
    // First pass: everything that does not need robots.txt. A source that may
    // not be scraped at all never reaches the code that would fetch robots.
    this.#assert(rawUrl, method, 'UNKNOWN');
    const url = new URL(rawUrl);
    const key = hostKey(url);
    const preDelay = effectiveDelayMs(this.#source.minDelayMs, undefined);

    if (this.#ledger.unreadableHosts.has(key)) {
      throw new ScrapeRequestError({
        kind: 'ROBOTS_DISALLOWED',
        refusal: 'ROBOTS_DISALLOWED',
        message: `robots.txt on ${url.host} could not be read earlier in this run.`,
      });
    }
    const robots = await this.#env.robots.lookup(url, preDelay, options.signal ?? this.#signal);
    if (robots.unreachable) {
      this.#ledger.unreadableHosts.add(key);
    }
    this.#assert(rawUrl, method, robots.verdict);

    const delay = effectiveDelayMs(this.#source.minDelayMs, robots.crawlDelaySeconds);
    return this.#env.queue.run(
      key,
      delay,
      () => this.#attempts(url, method, options, delay),
      options.signal ?? this.#signal,
    );
  }

  /** Runs the gate and turns a refusal into the error a run records. */
  #assert(url: string, method: ScrapeMethod, robots: RobotsVerdict): void {
    const decision = assessRequest({
      complianceStatus: this.#source.complianceStatus,
      isEnabled: this.#source.isEnabled,
      allowedPaths: this.#source.allowedPaths,
      robots,
      url,
      method,
      setupComplete: this.#env.setupComplete(),
      requestsMade: this.#ledger.requestsMade,
      cap: this.#budget.maxRequests,
      robotsExemption: this.#source.robotsExemption,
      credentialPresent: this.#source.credential !== undefined && !this.#ledger.credentialRejected,
    });
    if (decision.allowed && decision.robotsExempted === true && !this.#ledger.exemptionLogged) {
      // R77: said once per run, so an administrator can see the exemption is in use.
      this.#ledger.exemptionLogged = true;
      this.#env.logger.info(
        {
          source: this.#source.key,
          reviewedBy: this.#source.robotsExemption?.reviewedBy,
          reviewedAt: this.#source.robotsExemption?.reviewedAt,
        },
        'robots.txt disallows this API path; the reviewed exemption for authenticated API use was applied',
      );
    }
    if (!decision.allowed) {
      this.#env.logger.info(
        { source: this.#source.key, refusal: decision.refusal },
        'a request was refused by the compliance gate',
      );
      throw new ScrapeRequestError({
        kind: refusalErrorKind(decision.refusal),
        message: decision.reason,
        refusal: decision.refusal,
      });
    }
  }

  /** The attempt loop. At most `MAX_RETRIES` extra tries, and only for §7.2's kinds. */
  async #attempts(
    url: URL,
    method: ScrapeMethod,
    options: RequestOptions,
    delayMs: number,
  ): Promise<PoliteResponse> {
    let lastError: ScrapeRequestError | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (this.#ledger.requestsMade >= this.#budget.maxRequests) {
        throw (
          lastError ??
          new ScrapeRequestError({
            kind: 'UNKNOWN',
            message: `This run has already made its ${this.#budget.maxRequests} requests.`,
            refusal: 'REQUEST_CAP_REACHED',
          })
        );
      }
      const signedIn = await grantSignedIn(
        { env: this.#env, source: this.#source, ledger: this.#ledger, scope: this.#signedInScope },
        url,
        options,
        options.signal ?? this.#signal,
      );
      this.#ledger.requestsMade += 1;
      try {
        return await this.#once(url, method, options, signedIn);
      } catch (error) {
        if (!(error instanceof ScrapeRequestError)) {
          throw error;
        }
        lastError = error;
        const wait = retryDelay(error, attempt, delayMs, this.#budget.maxWaitMs, this.#env.random);
        if (wait === undefined) {
          throw error;
        }
        this.#env.logger.debug(
          { url: url.toString(), kind: error.kind, attempt: attempt + 1, waitMs: wait },
          'retrying a request',
        );
        await this.#env.sleep(wait, options.signal ?? this.#signal);
      }
    }
    throw lastError ?? new ScrapeRequestError({ kind: 'UNKNOWN', message: 'No attempt was made.' });
  }

  /** One request, one response, no retrying. */
  async #once(
    url: URL,
    method: ScrapeMethod,
    options: RequestOptions,
    signedIn: boolean,
  ): Promise<PoliteResponse> {
    const target = url.toString();
    const conditional = options.conditional === true ? this.#env.cache?.get(target) : undefined;
    const { headers, sentSession, sentCredential } = requestHeaders({
      host: url.hostname,
      userAgent: this.#env.userAgent(),
      accept: options.accept,
      credential: this.#ledger.credentialRejected ? undefined : this.#source.credential,
      session: signedIn ? this.#source.session : undefined,
      conditional,
    });
    if (sentSession) {
      this.#ledger.signedInMade += 1;
      this.#ledger.lastSignedInAt = this.#env.clock.now().getTime();
    }
    // R75: every request is tagged, so the log answers "was the session used?".
    this.#env.logger.debug(
      {
        source: this.#source.key,
        method,
        url: target,
        access: sentSession ? 'signed-in' : 'anonymous',
      },
      'request',
    );

    let response: TransportResponse;
    try {
      response = await this.#env.fetcher({
        url: target,
        method,
        headers,
        signal: options.signal ?? this.#signal,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        totalTimeoutMs: TOTAL_TIMEOUT_MS,
      });
    } catch (error) {
      const transport = asTransportError(error);
      throw new ScrapeRequestError({
        kind: transport.kind,
        message: `${method} ${target} failed: ${transport.message}`,
        cause: error,
      });
    }

    if (response.status === 304) {
      return notModifiedResponse(this.#env.cache, response, target, this.#env.clock.now());
    }
    if (response.status >= 400) {
      const refused = await credentialRefused(response, {
        session: sentSession,
        credential: sentCredential,
      });
      if (refused !== undefined) {
        throw this.#rejected(
          refused,
          response.status,
          `${method} ${target} answered ${response.status}`,
        );
      }
      throw statusError(response, target, method, this.#env.clock.now());
    }
    if (sentSession && isLoginRedirect(target, response.url)) {
      // R74: a signed-in read sent to the sign-in page is a 200 that means what
      // a 401 does, and would otherwise be parsed as an empty listing.
      const message = `${method} ${target} was redirected to a sign-in page`;
      throw this.#rejected('SESSION', response.status, message);
    }

    return storedResponse(this.#env.cache, response, target, method, this.#env.clock.now());
  }

  /**
   * R80: the site refused the credential. It is not offered again this run; a
   * refused session falls back to an anonymous read (see `retryDelay`), a
   * refused API key ends the request. `HTTP_4XX`, never `BLOCKED`, so R79's
   * count and the backoff ladder never see it.
   */
  #rejected(which: 'SESSION' | 'API_KEY', status: number, message: string): ScrapeRequestError {
    if (which === 'SESSION') {
      this.#ledger.sessionRejected = true;
    } else {
      this.#ledger.credentialRejected = true;
    }
    const what = which === 'SESSION' ? 'the stored session' : 'the API key';
    this.#env.logger.warn({ source: this.#source.key, status }, `${what} was refused (R80)`);
    return new ScrapeRequestError({
      kind: 'HTTP_4XX',
      status,
      credential: which,
      message: `${message}, so ${what} is no longer accepted.`,
    });
  }
}
