import { eq } from 'drizzle-orm';

import { httpCache, type HttpCacheRow } from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * The `http_cache` table (ruling R58), as the two operations the client needs.
 *
 * Validators are keyed by URL rather than by source record because that is what
 * they are about: a listing URL has no record at all, and once pagination is
 * involved the detail URLs outnumber the records. Keeping them here is what
 * makes a 304 free — no parse, no candidate, no write beyond `last_seen_at`.
 */
export interface CachedValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly contentHash: string;
}

/**
 * What the client needs from a validator store. An interface rather than the
 * class, so a test can hand the client a Map and the database-backed
 * implementation keeps its own test next to the schema.
 */
export interface ValidatorStore {
  get(url: string): CachedValidators | undefined;
  put(
    url: string,
    validators: { etag?: string | undefined; lastModified?: string | undefined },
    contentHash: string,
    fetchedAt: number,
  ): void;
  touch(url: string, fetchedAt: number): void;
}

/** An in-memory {@link ValidatorStore}; used by the client's own tests. */
export function memoryValidatorStore(): ValidatorStore {
  const entries = new Map<string, CachedValidators & { fetchedAt: number }>();
  return {
    get: (url) => entries.get(url),
    put: (url, validators, contentHash, fetchedAt) => {
      entries.set(url, {
        etag: validators.etag ?? null,
        lastModified: validators.lastModified ?? null,
        contentHash,
        fetchedAt,
      });
    },
    touch: (url, fetchedAt) => {
      const existing = entries.get(url);
      if (existing !== undefined) {
        entries.set(url, { ...existing, fetchedAt });
      }
    },
  };
}

export class HttpCacheStore implements ValidatorStore {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  get(url: string): CachedValidators | undefined {
    const row: HttpCacheRow | undefined = this.#db.drizzle
      .select()
      .from(httpCache)
      .where(eq(httpCache.url, url))
      .get();
    if (row === undefined) {
      return undefined;
    }
    return { etag: row.etag, lastModified: row.lastModified, contentHash: row.contentHash };
  }

  /**
   * Records what the server sent back. A response with neither validator still
   * gets a row: the content hash alone turns "200 with identical bytes" into an
   * unchanged item, which is most of what a 15-minute cadence sees.
   */
  put(
    url: string,
    validators: { etag?: string | undefined; lastModified?: string | undefined },
    contentHash: string,
    fetchedAt: number,
  ): void {
    const row = {
      url,
      etag: validators.etag ?? null,
      lastModified: validators.lastModified ?? null,
      contentHash,
      fetchedAt,
    };
    this.#db.drizzle
      .insert(httpCache)
      .values(row)
      .onConflictDoUpdate({ target: httpCache.url, set: row })
      .run();
  }

  /** Refreshes `fetched_at` after a 304, so "when did we last confirm this?" is honest. */
  touch(url: string, fetchedAt: number): void {
    this.#db.drizzle.update(httpCache).set({ fetchedAt }).where(eq(httpCache.url, url)).run();
  }
}
