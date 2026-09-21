import { nowMs, type Clock } from '../../../platform/time.js';
import type { PreviewedImport } from './preview.js';

/**
 * What the preview read, kept until the professor decides (WP-14).
 *
 * It exists so that **one import is one request** to somebody else's server. The
 * preview reads the page; the commit, seconds later, saves what was read. Without
 * this the commit would have to either fetch the page a second time — twice the
 * traffic for one import — or trust the client to send the source's data back,
 * which would let a `source_records` row say whatever a request body said.
 *
 * In memory, per process, and deliberately forgettable: a restart or a long
 * pause simply means the commit re-reads an approved source's page, or saves a
 * generic page's fields as the professor reviewed them. Nothing here is state
 * anybody depends on.
 */

/** Long enough to read a form carefully, short enough to be a cache. */
export const PREVIEW_TTL_MS = 30 * 60_000;

/** A ceiling, so a burst of previews cannot grow the process without bound. */
export const MAX_PREVIEWS = 100;

interface Entry {
  readonly at: number;
  readonly value: PreviewedImport;
}

export class PreviewCache {
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #entries = new Map<string, Entry>();

  constructor(clock: Clock, ttlMs = PREVIEW_TTL_MS, max = MAX_PREVIEWS) {
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#max = max;
  }

  /** Keyed by user as well as URL: one professor's preview is not another's. */
  #key(userId: string, url: string): string {
    return `${userId}\u0000${url}`;
  }

  put(userId: string, url: string, value: PreviewedImport): void {
    const at = nowMs(this.#clock);
    this.#prune(at);
    // Map preserves insertion order, so the oldest key is the first one.
    if (this.#entries.size >= this.#max) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }
    this.#entries.set(this.#key(userId, url), { at, value });
  }

  /** The preview, if it is still here. Reading does not consume it: a commit
   * that fails validation is retried with the same preview. */
  get(userId: string, url: string): PreviewedImport | undefined {
    const at = nowMs(this.#clock);
    this.#prune(at);
    return this.#entries.get(this.#key(userId, url))?.value;
  }

  get size(): number {
    return this.#entries.size;
  }

  #prune(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (now - entry.at > this.#ttlMs) {
        this.#entries.delete(key);
      }
    }
  }
}
