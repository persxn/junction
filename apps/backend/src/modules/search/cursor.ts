import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { EventQuery } from '@compintel/contracts';

import { canonicalJson } from '../../platform/audit.js';
import type { SortBasis } from './domain/normalize.js';
import { invalidCursor } from './errors.js';

/**
 * Keyset pagination cursors (§8, WP-15a step 4).
 *
 * A cursor is the last row's position — `(nullRank, sortKey, id)` — so the next
 * page is "rows after this one", not "rows after the first N". That is what
 * keeps a scroll stable when a scrape inserts events mid-way: an offset would
 * shift every later row by one and show one of them twice.
 *
 * It is **signed**, not just encoded. The payload is base64url JSON and an
 * HMAC-SHA256 over it follows the dot; a cursor edited by hand, cut short, or
 * minted for a *different* query (the fingerprint is inside the signature)
 * answers `SEARCH_INVALID_CURSOR` instead of silently paging through the wrong
 * result set. The key is per process: a cursor does not survive a backend
 * restart, and the UI starts the list again, which is the honest answer.
 */

export interface CursorPosition {
  /** 1 when the row's sort key is NULL (NULLs sort last). */
  readonly nullRank: 0 | 1;
  readonly sortKey: number | null;
  readonly id: string;
}

interface Payload {
  readonly v: 1;
  /** Query fingerprint. */
  readonly f: string;
  readonly b: SortBasis;
  readonly n: 0 | 1;
  readonly k: number | null;
  readonly i: string;
}

const SIGNATURE_BYTES = 16;

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export class CursorCodec {
  readonly #key: Buffer;

  constructor(key: Buffer = randomBytes(32)) {
    this.#key = key;
  }

  /** Everything that shapes the result set except where the page starts and how long it is. */
  static fingerprint(query: EventQuery): string {
    const { cursor: _cursor, limit: _limit, ...shape } = query;
    return createHash('sha256').update(canonicalJson(shape)).digest('hex').slice(0, 32);
  }

  #sign(body: string): Buffer {
    return createHmac('sha256', this.#key).update(body).digest().subarray(0, SIGNATURE_BYTES);
  }

  encode(position: CursorPosition, fingerprint: string, basis: SortBasis): string {
    const payload: Payload = {
      v: 1,
      f: fingerprint,
      b: basis,
      n: position.nullRank,
      k: position.sortKey,
      i: position.id,
    };
    const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return `${body}.${base64url(this.#sign(body))}`;
  }

  /** The position a cursor names, or `SEARCH_INVALID_CURSOR`. Never trusts an unsigned byte. */
  decode(token: string, fingerprint: string, basis: SortBasis): CursorPosition {
    const [body, signature, extra] = token.split('.');
    if (body === undefined || signature === undefined || extra !== undefined) {
      throw invalidCursor();
    }
    const given = Buffer.from(signature, 'base64url');
    const expected = this.#sign(body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw invalidCursor();
    }
    let payload: Partial<Payload>;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Payload>;
    } catch {
      throw invalidCursor();
    }
    const validKey =
      payload.k === null || (typeof payload.k === 'number' && Number.isFinite(payload.k));
    if (
      payload.v !== 1 ||
      payload.f !== fingerprint ||
      payload.b !== basis ||
      (payload.n !== 0 && payload.n !== 1) ||
      !validKey ||
      typeof payload.i !== 'string' ||
      payload.i.length === 0
    ) {
      throw invalidCursor();
    }
    return { nullRank: payload.n, sortKey: payload.k ?? null, id: payload.i };
  }
}
