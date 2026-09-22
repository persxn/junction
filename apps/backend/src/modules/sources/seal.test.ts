import { describe, expect, it } from 'vitest';

import { isSealed, parseSessionKey, sameKey, seal, SEAL_PREFIX, unseal } from './seal.js';

/**
 * The seal itself (ruling R76), away from any source or settings store.
 *
 * What is worth asserting here is what a copy of the database would give
 * somebody: not the cookie, not with the wrong key, and not with a byte
 * changed — and that every one of those failures is `undefined` rather than a
 * throw, because a backend without a key is a supported state.
 */

const KEY = parseSessionKey('5e'.repeat(32));
const OTHER = parseSessionKey('a1'.repeat(32));
const COOKIE = 'df_session=abc123; other=zzz';

describe('the key', () => {
  it('is 32 bytes of hex, and anything else is no key at all', () => {
    expect(parseSessionKey('5e'.repeat(32))).toHaveLength(32);
    // Case is not a reason to refuse a key the shell wrote.
    expect(parseSessionKey('5E'.repeat(32))).toHaveLength(32);
    expect(parseSessionKey('  ' + '5e'.repeat(32) + '  ')).toHaveLength(32);
    for (const bad of [undefined, '', 'nope', '5e'.repeat(31), '5e'.repeat(33), 'zz'.repeat(32)]) {
      expect(parseSessionKey(bad)).toBeUndefined();
    }
  });

  it('compares without saying where two keys differ', () => {
    expect(sameKey(KEY, parseSessionKey('5e'.repeat(32)))).toBe(true);
    expect(sameKey(KEY, OTHER)).toBe(false);
    expect(sameKey(undefined, undefined)).toBe(true);
    expect(sameKey(KEY, undefined)).toBe(false);
  });
});

describe('sealing a session', () => {
  it('round-trips, and what is stored is not the cookie', () => {
    const sealed = seal(KEY, COOKIE);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed.startsWith(SEAL_PREFIX)).toBe(true);
    expect(sealed).not.toContain('abc123');
    expect(sealed).not.toContain('df_session');
    expect(unseal(KEY, sealed)).toBe(COOKIE);
  });

  it('is different every time, so two sources with one cookie do not look alike', () => {
    expect(seal(KEY, COOKIE)).not.toBe(seal(KEY, COOKIE));
  });

  it('opens with nothing but the right key', () => {
    const sealed = seal(KEY, COOKIE);
    expect(unseal(OTHER, sealed)).toBeUndefined();
    expect(unseal(undefined, sealed)).toBeUndefined();
  });

  it('refuses a blob that has been changed, rather than answering with rubbish', () => {
    const sealed = seal(KEY, COOKIE);
    const body = sealed.slice(SEAL_PREFIX.length);
    const tampered = SEAL_PREFIX + (body.startsWith('A') ? 'B' : 'A') + body.slice(1);
    expect(unseal(KEY, tampered)).toBeUndefined();
    expect(unseal(KEY, SEAL_PREFIX + body.slice(0, 8))).toBeUndefined();
    expect(unseal(KEY, SEAL_PREFIX)).toBeUndefined();
  });

  it('treats a value that was never sealed as no session', () => {
    expect(isSealed(COOKIE)).toBe(false);
    expect(unseal(KEY, COOKIE)).toBeUndefined();
    expect(unseal(KEY, '')).toBeUndefined();
  });

  it('refuses to seal without a key rather than storing plaintext', () => {
    expect(() => seal(undefined, COOKIE)).toThrow(/no session key/i);
  });

  it('carries whatever a cookie header can hold', () => {
    for (const value of ['a=1', 'x'.repeat(8192), 'name=välue; ünicode=ok']) {
      expect(unseal(KEY, seal(KEY, value))).toBe(value);
    }
  });
});
