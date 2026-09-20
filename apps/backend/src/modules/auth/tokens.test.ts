import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_SESSION_MS,
  bearerToken,
  generateSessionToken,
  hashesMatch,
  hashToken,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_TOKEN_BYTES,
} from './tokens.js';

describe('session tokens (ruling R33, §4.12)', () => {
  it('is 256 bits of randomness, hex-encoded', () => {
    expect(SESSION_TOKEN_BYTES).toBe(32);
    expect(generateSessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(seen.size).toBe(200);
  });

  it('takes an injected random source, so a test can fix the token', () => {
    const token = generateSessionToken(() => Buffer.alloc(SESSION_TOKEN_BYTES, 0xab));
    expect(token).toBe('ab'.repeat(32));
  });

  it('hashes with SHA-256, and the hash is not the token', () => {
    const token = generateSessionToken();
    const hash = hashToken(token);
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
  });

  it('hashes the same token the same way and different tokens differently', () => {
    expect(hashToken('a')).toBe(hashToken('a'));
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('the R33 clocks', () => {
  it('fixes the absolute lifetime at 12 hours', () => {
    expect(ABSOLUTE_SESSION_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('fixes the refresh window at a minute', () => {
    expect(SESSION_REFRESH_INTERVAL_MS).toBe(60_000);
  });
});

describe('hashesMatch', () => {
  it('compares equal hashes as equal', () => {
    expect(hashesMatch('a'.repeat(64), 'a'.repeat(64))).toBe(true);
  });

  it('refuses different ones, including different lengths', () => {
    expect(hashesMatch('a'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(hashesMatch('a'.repeat(64), 'a'.repeat(63))).toBe(false);
    expect(hashesMatch('', '')).toBe(true);
  });
});

describe('bearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('bearer abc123')).toBe('abc123');
    expect(bearerToken('  Bearer   abc123  ')).toBe('abc123');
  });

  it('returns undefined for anything else', () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken('')).toBeUndefined();
    expect(bearerToken('Basic abc123')).toBeUndefined();
    expect(bearerToken('Bearer')).toBeUndefined();
    expect(bearerToken('Bearer ')).toBeUndefined();
    // Two tokens is not one token.
    expect(bearerToken('Bearer a b')).toBeUndefined();
  });
});
