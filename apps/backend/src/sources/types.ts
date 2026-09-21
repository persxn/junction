import type { AdapterKind, EventCandidate } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { Clock } from '../platform/time.js';
import type { PoliteHttpClient } from '../scraping/http/index.js';

/**
 * The adapter contract (§7.1, ADR-0007).
 *
 * Three rules make an adapter testable with nothing but recorded fixtures, and
 * all three are in the types rather than in a convention:
 *
 * 1. **An adapter never touches the database.** Nothing in `AdapterContext`
 *    leads to one. The orchestrator owns every write.
 * 2. **Its only network access is the `PoliteHttpClient`** — so the compliance
 *    gate, the crawl-delay and the request cap are not things an adapter can
 *    forget, they are the only door it has.
 * 3. **`normalize()` is pure.** Given the same bytes and the same context it
 *    returns the same candidate, which is what makes a golden file meaningful.
 */

/** What an adapter is handed. Deliberately small (§7.1). */
export interface AdapterContext {
  /** The only network access an adapter has. */
  readonly http: PoliteHttpClient;
  readonly log: Logger;
  readonly clock: Clock;
  now(): Date;
  /** Aborted on shutdown; a long walk must honour it. */
  readonly signal: AbortSignal;
  /** `sources.config_json`, already parsed. Each adapter validates its own. */
  readonly config: unknown;
  /**
   * WP-12: whether this source already holds a record under the key — a
   * read-only question, so an adapter can close out ended items it knows
   * (§7.6) without ever touching the database itself.
   */
  readonly isKnown?: (externalKey: string) => boolean;
}

/**
 * One item from a listing page, before normalization. `payload` is whatever the
 * adapter pulled out of the response; `raw` is the bytes to snapshot, when the
 * adapter kept them.
 */
export interface ListingItem {
  /** The source's own identifier; unique within the source (§6.2 UQ). */
  readonly externalKey: string;
  /** The canonical public URL of this item. */
  readonly url: string;
  readonly payload: unknown;
  /** Raw response bytes for §7.8's snapshot; omitted when not worth keeping. */
  readonly raw?: Uint8Array;
}

/** A detail fetch's result, fed back through `normalize()`. */
export interface RawDetail {
  readonly item: ListingItem;
  readonly payload: unknown;
  readonly raw?: Uint8Array;
  /**
   * WP-12: the detail could not be fetched (robots on its host, for one) and the
   * listing's data stands in; the run is recorded PARTIAL.
   */
  readonly degraded?: boolean;
}

/**
 * What a listing walk reports when it finishes (A8). `complete` is the adapter's
 * own claim that it walked the whole listing it is scoped to without hitting a
 * page or request cap — §7.6 counts only complete runs towards MISSING, so an
 * adapter that guesses here would start marking live events as gone.
 */
export interface ListingResult {
  readonly complete: boolean;
  /**
   * The listing answered 304 (§7.2's conditional GETs), so nothing was parsed
   * and nothing was yielded.
   *
   * It has to be said out loud rather than inferred from "complete walk, zero
   * items", because those two look identical and mean opposite things: an empty
   * listing is evidence every record has gone, and a 304 is evidence none of
   * them has. The orchestrator counts every currently-listed record as
   * `items_unchanged` and leaves §7.6's clock where it was.
   */
  readonly notModified?: boolean;
}

/**
 * The listing walk. An async generator rather than a plain iterable so that
 * `complete` rides back with the walk that produced it: a separate call could be
 * forgotten, and a flag on the context could be set before the walk failed.
 */
export type ListingWalk = AsyncGenerator<ListingItem, ListingResult | void, void>;

export interface SourceAdapter {
  /** Matches `sources.key`. */
  readonly key: string;
  readonly displayName: string;
  readonly kind: AdapterKind;
  /** True → the Playwright/Edge path (§4.8). No adapter uses it yet. */
  readonly needsBrowser: boolean;
  readonly defaultCadenceMinutes: number;
  listing(context: AdapterContext): ListingWalk;
  detail?(context: AdapterContext, item: ListingItem): Promise<RawDetail>;
  /**
   * WP-14: the listing item one pasted URL stands for, or `undefined` when the
   * URL is on this source's domain but is not one of its event pages.
   *
   * Pure, and it never touches the network: URL import asks this *before*
   * deciding to fetch anything, so a link to a profile page or a search result
   * opens the manual form instead of being requested. An adapter that has no
   * single-page read does not implement it, and its domain is then never
   * fetched one page at a time.
   */
  itemFromUrl?(url: string): ListingItem | undefined;
  /** Pure (§7.1): same input, same candidate, no clock of its own beyond `ctx`. */
  normalize(input: ListingItem | RawDetail, context: NormalizeContext): EventCandidate;
}

/** What `normalize()` may know about the world. */
export interface NormalizeContext {
  readonly clock: Clock;
  readonly sourceKey: string;
  /** Default timezone for a source that states local times without a zone. */
  readonly defaultTimeZone: string;
}
