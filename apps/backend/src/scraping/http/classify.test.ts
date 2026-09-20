import { describe, expect, it } from 'vitest';

import { classifyStatus, classifyTransportError, parseRetryAfter } from './classify.js';
import { TransportError } from './types.js';

/**
 * The classifier, tested against synthetic Node errors rather than real ones.
 *
 * The codes below are what undici and OpenSSL actually produce, taken from the
 * eight expired certificates and two dead domains WP-02 found among the 117
 * campus sites. A test that only used `TransportError` would prove nothing
 * about the day one of those is scraped for real.
 */

function nodeError(code: string, nested = false): Error {
  const inner = Object.assign(new Error(code), { code });
  return nested ? Object.assign(new Error('fetch failed'), { cause: inner }) : inner;
}

describe('classifyTransportError', () => {
  it('passes an already-classified error straight through', () => {
    expect(classifyTransportError(new TransportError('RATE_LIMITED', 'x'))).toBe('RATE_LIMITED');
  });

  it.each([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('reads %s as TLS, which is never worked around', (code) => {
    expect(classifyTransportError(nodeError(code))).toBe('TLS');
    expect(classifyTransportError(nodeError(code, true))).toBe('TLS');
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])('reads %s as DNS', (code) => {
    expect(classifyTransportError(nodeError(code))).toBe('DNS');
  });

  it.each(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ETIMEDOUT'])(
    'reads %s as TIMEOUT',
    (code) => {
      expect(classifyTransportError(nodeError(code))).toBe('TIMEOUT');
    },
  );

  it('reads an abort as a timeout, since that is what cut it short', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyTransportError(aborted)).toBe('TIMEOUT');
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'EPIPE'])('reads %s as NETWORK', (code) => {
    expect(classifyTransportError(nodeError(code))).toBe('NETWORK');
  });

  it('falls back to NETWORK for something with no code at all', () => {
    expect(classifyTransportError(new Error('who knows'))).toBe('NETWORK');
    expect(classifyTransportError('a string')).toBe('NETWORK');
  });
});

describe('classifyStatus', () => {
  it('calls 403 BLOCKED rather than a 4xx (R60)', () => {
    expect(classifyStatus(403)).toBe('BLOCKED');
    expect(classifyStatus(401)).toBe('BLOCKED');
    expect(classifyStatus(451)).toBe('BLOCKED');
  });

  it('calls 429 and 503 RATE_LIMITED, because both mean "slow down"', () => {
    expect(classifyStatus(429)).toBe('RATE_LIMITED');
    expect(classifyStatus(503)).toBe('RATE_LIMITED');
  });

  it('separates the rest of the 4xx and 5xx ranges', () => {
    expect(classifyStatus(404)).toBe('HTTP_4XX');
    expect(classifyStatus(418)).toBe('HTTP_4XX');
    expect(classifyStatus(500)).toBe('HTTP_5XX');
    expect(classifyStatus(502)).toBe('HTTP_5XX');
  });
});

describe('parseRetryAfter (RFC 9110)', () => {
  const now = new Date('2026-09-21T10:00:00.000Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('  30  ', now)).toBe(30_000);
    expect(parseRetryAfter('0', now)).toBe(0);
  });

  it('reads an HTTP-date as the time remaining', () => {
    expect(parseRetryAfter('Mon, 21 Sep 2026 10:05:00 GMT', now)).toBe(5 * 60_000);
  });

  it('never returns a negative wait for a date in the past', () => {
    expect(parseRetryAfter('Mon, 21 Sep 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('answers undefined rather than guessing at something unparseable', () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter('', now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
  });
});
