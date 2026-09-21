import type { EventCandidate, ScrapeErrorKind } from '@compintel/contracts';
import { pino, type Logger } from 'pino';

import { sources, sourceState, type SourceRow } from '../db/schema/index.js';
import type { DatabaseHandle } from '../platform/db.js';
import { uuid7 } from '../platform/ids.js';
import type { Clock } from '../platform/time.js';
import {
  ScrapingHttp,
  TransportError,
  type ValidatorStore,
  type Fetcher,
  type Sleeper,
  type TransportRequest,
  type TransportResponse,
} from '../scraping/http/index.js';
import type { ListingItem, ListingWalk, SourceAdapter } from '../sources/types.js';

/**
 * Test doubles for the scraping layer.
 *
 * The important one is {@link fakeTransport}. Every test in `pnpm verify` goes
 * through it or through a `node:http` server on 127.0.0.1, which is what makes
 * "no test opens an internet socket" a property of the wiring rather than a
 * promise: `undiciFetcher` is passed in exactly one place, `main.ts`, and no
 * test constructs a `ScrapingHttp` with it.
 */

/** A silent logger; a test that wants output builds its own. */
export const silentLogger: Logger = pino({ enabled: false });

export interface FakeResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** A string, bytes, or a list of chunks the client must read one at a time. */
  readonly body?: string | Uint8Array | readonly Uint8Array[];
  /** Throw instead of answering — a timeout, a bad certificate, a dead host. */
  readonly throws?: ScrapeErrorKind;
}

export interface FakeTransport {
  readonly fetcher: Fetcher;
  /** Every request the client actually made, in order. */
  readonly calls: TransportRequest[];
  /** How many chunks of each response body were pulled. */
  readonly chunksRead: Map<string, number>;
  /** Requests to one URL. */
  countFor(url: string): number;
}

function bytes(body: FakeResponse['body']): readonly Uint8Array[] {
  if (body === undefined) {
    return [new Uint8Array(0)];
  }
  if (typeof body === 'string') {
    return [new TextEncoder().encode(body)];
  }
  if (body instanceof Uint8Array) {
    return [body];
  }
  return body;
}

/**
 * A transport that answers from a table. A URL mapped to an array answers each
 * entry in turn and then repeats the last one, which is how the retry tests say
 * "fail twice, then succeed".
 */
export function fakeTransport(
  routes: Readonly<Record<string, FakeResponse | readonly FakeResponse[]>>,
): FakeTransport {
  const calls: TransportRequest[] = [];
  const chunksRead = new Map<string, number>();
  const seen = new Map<string, number>();

  const fetcher: Fetcher = (request) => {
    calls.push(request);
    const entry = routes[request.url];
    if (entry === undefined) {
      return Promise.reject(
        new TransportError('DNS', `The fake transport has no route for ${request.url}.`),
      );
    }
    const list = Array.isArray(entry)
      ? (entry as readonly FakeResponse[])
      : [entry as FakeResponse];
    const index = seen.get(request.url) ?? 0;
    seen.set(request.url, index + 1);
    const response = list[Math.min(index, list.length - 1)]!;
    if (response.throws !== undefined) {
      return Promise.reject(
        new TransportError(response.throws, `${response.throws} from the fake transport`),
      );
    }
    const chunks = bytes(response.body);
    const url = request.url;
    const result: TransportResponse = {
      status: response.status ?? 200,
      headers: response.headers ?? {},
      url,
      // A generator, so a client that stops early really does stop pulling and
      // the count below is evidence of it.
      body: (async function* stream(): AsyncGenerator<Uint8Array> {
        for (const chunk of chunks) {
          chunksRead.set(url, (chunksRead.get(url) ?? 0) + 1);
          yield await Promise.resolve(chunk);
        }
      })(),
    };
    return Promise.resolve(result);
  };

  return {
    fetcher,
    calls,
    chunksRead,
    countFor: (url) => calls.filter((call) => call.url === url).length,
  };
}

/** A sleeper that records what it was asked to wait and returns at once. */
export function manualSleeper(): Sleeper & { readonly waits: number[] } {
  const waits: number[] = [];
  const sleep = ((ms: number) => {
    waits.push(ms);
    return Promise.resolve();
  }) as Sleeper & { waits: number[] };
  sleep.waits = waits;
  return sleep;
}

/** A clock a test moves by hand. */
export function movableClock(startIso: string): Clock & { advance(ms: number): void } {
  let at = Date.parse(startIso);
  return {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
}

export interface TestScrapingHttpOptions {
  readonly transport: FakeTransport;
  readonly clock: Clock;
  readonly sleep?: Sleeper;
  readonly contactEmail?: string;
  readonly setupComplete?: boolean;
  readonly online?: boolean;
  readonly maxWaitMs?: number;
  readonly cache?: ValidatorStore;
  /** Defaults to silent; pass one to capture what the HTTP layer logs. */
  readonly logger?: Logger;
}

/** A `ScrapingHttp` wired entirely to doubles. */
export function testScrapingHttp(options: TestScrapingHttpOptions): ScrapingHttp {
  return new ScrapingHttp({
    fetcher: options.transport.fetcher,
    logger: options.logger ?? silentLogger,
    clock: options.clock,
    sleep: options.sleep ?? manualSleeper(),
    // Pinned jitter, so a retry delay is exactly the base times the step.
    random: () => 0.5,
    appVersion: '1.2.3',
    contactEmail: () => options.contactEmail ?? 'tech.office@example.edu',
    setupComplete: () => options.setupComplete ?? true,
    hasNetworkInterface: () => options.online ?? true,
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
  });
}

export interface SourceFixture {
  readonly key?: string;
  readonly name?: string;
  readonly adapter?: SourceRow['adapter'];
  readonly complianceStatus?: SourceRow['complianceStatus'];
  readonly isEnabled?: boolean;
  readonly allowedPaths?: readonly string[];
  readonly minDelayMs?: number;
  readonly maxRequestsPerRun?: number;
  readonly cadenceMinutes?: number;
  readonly manualMinIntervalMinutes?: number;
  readonly configJson?: string;
  readonly trustRank?: number;
}

/** Inserts a source plus its health row and returns the row. */
export function insertSource(db: DatabaseHandle, fixture: SourceFixture = {}): SourceRow {
  const now = Date.now();
  const row: SourceRow = {
    id: uuid7(),
    key: fixture.key ?? 'testsource',
    name: fixture.name ?? 'Test Source',
    adapter: fixture.adapter ?? 'CTFTIME_API',
    configJson: fixture.configJson ?? '{}',
    isEnabled: fixture.isEnabled ?? true,
    cadenceMinutes: fixture.cadenceMinutes ?? 30,
    manualMinIntervalMinutes: fixture.manualMinIntervalMinutes ?? 10,
    minDelayMs: fixture.minDelayMs ?? 3_000,
    maxRequestsPerRun: fixture.maxRequestsPerRun ?? 6,
    allowedPathsJson: JSON.stringify(fixture.allowedPaths ?? ['example.test/api/']),
    attributionText: null,
    trustRank: fixture.trustRank ?? 40,
    complianceStatus: fixture.complianceStatus ?? 'APPROVED_WITH_LIMITS',
    complianceNotes: 'inserted by a test',
    complianceReviewedAt: now,
    complianceReviewedBy: 'test',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  db.drizzle.insert(sources).values(row).run();
  db.drizzle
    .insert(sourceState)
    .values({ sourceId: row.id, nextDueAt: now, consecutiveFailures: 0 })
    .onConflictDoNothing()
    .run();
  return row;
}

/** The smallest `EventCandidate` that validates, with the given identity. */
export function minimalCandidate(overrides: Partial<EventCandidate> = {}): EventCandidate {
  return {
    sourceKey: 'testsource',
    externalKey: 'e1',
    url: 'https://example.test/api/events/1/',
    title: 'Test Hackathon',
    titleRaw: 'Test Hackathon',
    eventType: { value: 'HACKATHON', confidence: 1 },
    mode: { value: 'ONLINE', confidence: 1 },
    isRecurringRound: false,
    warnings: [],
    ...overrides,
  };
}

export interface TestAdapterOptions {
  readonly key?: string;
  readonly items?: readonly ListingItem[];
  readonly complete?: boolean;
  /** Reported by the walk: the listing answered 304. */
  readonly notModified?: boolean;
  /** Thrown from `listing()` before anything is yielded. */
  readonly throwsBeforeItems?: unknown;
  /** Thrown after `throwAfter` items have been yielded. */
  readonly throwsAfterItems?: unknown;
  readonly throwAfter?: number;
  /** Called per item; return something `EventCandidate` rejects to make it invalid. */
  readonly normalize?: (item: ListingItem) => unknown;
  readonly detail?: SourceAdapter['detail'];
  /** A URL the listing walk fetches through the client before yielding. */
  readonly fetches?: readonly string[];
}

/** Whatever a test wanted thrown, as something the linter agrees is throwable. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** An adapter that yields a fixed list, for testing the orchestrator. */
export function testAdapter(options: TestAdapterOptions = {}): SourceAdapter {
  const key = options.key ?? 'testsource';
  const adapter: SourceAdapter = {
    key,
    displayName: 'Test Source',
    kind: 'CTFTIME_API',
    needsBrowser: false,
    defaultCadenceMinutes: 30,
    listing: (context): ListingWalk =>
      (async function* walk(): ListingWalk {
        if (options.throwsBeforeItems !== undefined) {
          throw asError(options.throwsBeforeItems);
        }
        for (const url of options.fetches ?? []) {
          await context.http.get(url);
        }
        let yielded = 0;
        for (const item of options.items ?? []) {
          if (
            options.throwsAfterItems !== undefined &&
            yielded === (options.throwAfter ?? Number.POSITIVE_INFINITY)
          ) {
            throw asError(options.throwsAfterItems);
          }
          yield item;
          yielded += 1;
        }
        return { complete: options.complete ?? true, notModified: options.notModified ?? false };
      })(),
    normalize: (input) => {
      const item = 'externalKey' in input ? input : input.item;
      const produced = options.normalize?.(item);
      return (produced ??
        minimalCandidate({
          sourceKey: key,
          externalKey: item.externalKey,
          url: item.url,
        })) as EventCandidate;
    },
  };
  if (options.detail !== undefined) {
    return { ...adapter, detail: options.detail };
  }
  return adapter;
}

/** A listing item with a payload whose hash changes when `revision` does. */
export function listingItem(externalKey: string, revision = 1, raw?: string): ListingItem {
  return {
    externalKey,
    url: `https://example.test/api/events/${externalKey}/`,
    payload: { externalKey, revision },
    ...(raw === undefined ? {} : { raw: new TextEncoder().encode(raw) }),
  };
}
