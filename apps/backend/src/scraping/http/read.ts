import { createHash } from 'node:crypto';

import { TransportError, type TransportResponse } from './types.js';

/**
 * Reading a response body without ever holding more than the cap (§4.8's 5 MB).
 *
 * The cap is checked *before* each chunk is kept, and the iterator's `return()`
 * is called the moment it is exceeded, which is what tells undici to destroy the
 * socket. A version that concatenated first and measured afterwards would have
 * the same error message and none of the protection, so the test asserts on how
 * many chunks the fake transport was asked for, not on the error.
 */
export interface ReadResult {
  readonly body: Uint8Array;
  /** SHA-256 hex of the bytes, computed while reading rather than after. */
  readonly contentHash: string;
}

export async function readCapped(
  response: TransportResponse,
  maxBytes: number,
): Promise<ReadResult> {
  const chunks: Uint8Array[] = [];
  const hash = createHash('sha256');
  let total = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) {
        break;
      }
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        // Not NETWORK: nothing went wrong on the wire, and a retry would only
        // pull the same oversized body again. UNKNOWN is the honest kind for
        // "we stopped this on purpose", and it is not retried.
        throw new TransportError(
          'UNKNOWN',
          `The response is larger than the ${maxBytes}-byte cap, so it was abandoned.`,
        );
      }
      hash.update(chunk);
      chunks.push(chunk);
    }
  } finally {
    // Destroys the socket when we stopped early; a no-op when we did not.
    await iterator.return?.();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentHash: hash.digest('hex') };
}

/** One source of truth for turning a body into text; UTF-8, always. */
export function decode(body: Uint8Array): string {
  return new TextDecoder('utf-8').decode(body);
}
