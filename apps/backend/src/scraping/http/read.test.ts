import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decode, readCapped } from './read.js';
import { TransportError, type TransportResponse } from './types.js';

/**
 * Bodies arrive as they came off the wire. Every request asks for gzip, so a
 * compressed answer is the normal case on a live site — the first live CTFtime
 * run on a fresh install failed as SCHEMA_CHANGED because nothing decoded it.
 */

const JSON_BODY = JSON.stringify([{ id: 1, title: 'Example CTF' }]);

function response(body: Uint8Array, encoding?: string, chunkSize = 7): TransportResponse {
  async function* chunks(): AsyncIterable<Uint8Array> {
    for (let offset = 0; offset < body.byteLength; offset += chunkSize) {
      yield body.subarray(offset, offset + chunkSize);
      await Promise.resolve();
    }
  }
  return {
    status: 200,
    url: 'https://ctftime.org/api/v1/events/',
    headers: encoding === undefined ? {} : { 'content-encoding': encoding },
    body: chunks(),
  };
}

describe('readCapped decodes what the server compressed', () => {
  it.each([
    ['gzip', gzipSync],
    ['x-gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)('%s', async (encoding, compress) => {
    const { body, contentHash } = await readCapped(
      response(compress(Buffer.from(JSON_BODY)), encoding),
      1_000_000,
    );
    expect(decode(body)).toBe(JSON_BODY);
    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves an identity body alone, and hashes the same bytes either way', async () => {
    const plain = await readCapped(response(Buffer.from(JSON_BODY)), 1_000_000);
    const zipped = await readCapped(
      response(gzipSync(Buffer.from(JSON_BODY)), ' GZIP '),
      1_000_000,
    );
    expect(decode(plain.body)).toBe(JSON_BODY);
    expect(zipped.contentHash).toBe(plain.contentHash);
  });

  it('caps the decoded size, so a small bomb is abandoned part-way', async () => {
    const bomb = gzipSync(Buffer.alloc(5_000_000));
    expect(bomb.byteLength).toBeLessThan(10_000);
    await expect(readCapped(response(bomb, 'gzip', 512), 100_000)).rejects.toThrow(
      /larger than the 100000-byte cap/,
    );
  });

  it('calls a corrupt compressed body a transport error, not a crash', async () => {
    const error = await readCapped(
      response(Buffer.from('this is not gzip at all'), 'gzip'),
      1_000,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).message).toMatch(/could not be decoded/);
  });

  it('refuses an encoding it cannot read instead of passing bytes through', async () => {
    await expect(readCapped(response(Buffer.from('x'), 'zstd'), 1_000)).rejects.toThrow(
      /unsupported Content-Encoding \(zstd\)/,
    );
  });
});
