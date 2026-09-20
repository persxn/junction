import { UUID_V7_PATTERN, Uuid7, uuid7Timestamp } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { createUuid7, uuid7 } from './ids.js';

describe('createUuid7', () => {
  it('produces ids the contract accepts', () => {
    const next = createUuid7();
    for (let index = 0; index < 100; index += 1) {
      expect(Uuid7.safeParse(next()).success).toBe(true);
    }
  });

  it('sets version 7 and variant 10 (RFC 9562)', () => {
    const id = createUuid7(() => 1_789_000_000_000)();
    const hex = id.replace(/-/g, '');
    const versionNibble = Number.parseInt(hex[12] ?? '', 16);
    const variantNibble = Number.parseInt(hex[16] ?? '', 16);
    expect(versionNibble).toBe(7);
    expect(variantNibble & 0b1100).toBe(0b1000);
  });

  it('carries the millisecond the id was minted at', () => {
    const when = 1_789_123_456_789;
    expect(uuid7Timestamp(createUuid7(() => when)())).toBe(when);
  });

  it('is lexicographically ordered across milliseconds', () => {
    let now = 1_789_000_000_000;
    const next = createUuid7(() => now);
    const ids = Array.from({ length: 50 }, () => {
      now += 1;
      return next();
    });
    expect([...ids].sort()).toStrictEqual(ids);
  });

  it('keeps 10k ids minted in the same millisecond in generation order', () => {
    const next = createUuid7(() => 1_789_000_000_000);
    const ids = Array.from({ length: 10_000 }, () => next());

    expect(new Set(ids).size).toBe(10_000);
    expect([...ids].sort()).toStrictEqual(ids);
    for (const id of ids) {
      expect(UUID_V7_PATTERN.test(id)).toBe(true);
    }
  });

  it('borrows a millisecond when the 12-bit counter overflows', () => {
    const when = 1_789_000_000_000;
    const next = createUuid7(() => when);
    // 4096 ids fit in one millisecond (counter 0..4095); the 4097th must move on.
    const ids = Array.from({ length: 4098 }, () => next());
    expect(uuid7Timestamp(ids[4095] ?? '')).toBe(when);
    expect(uuid7Timestamp(ids[4096] ?? '')).toBe(when + 1);
    expect([...ids].sort()).toStrictEqual(ids);
  });

  it('never goes backwards when the clock does', () => {
    let now = 1_789_000_000_000;
    const next = createUuid7(() => now);

    const before = next();
    now -= 60_000; // an NTP correction, a VM resume, a user changing the clock
    const during = Array.from({ length: 500 }, () => next());
    now += 120_000;
    const after = next();

    const all = [before, ...during, after];
    expect([...all].sort()).toStrictEqual(all);
    expect(new Set(all).size).toBe(all.length);
    expect(uuid7Timestamp(during[0] ?? '')).toBeGreaterThanOrEqual(uuid7Timestamp(before));
  });

  it('rejects a clock outside the 48-bit range', () => {
    expect(() => createUuid7(() => -1)()).toThrow(RangeError);
    expect(() => createUuid7(() => 0x1000000000000)()).toThrow(RangeError);
    expect(() => createUuid7(() => Number.NaN)()).toThrow(RangeError);
  });

  it('generates distinct ids from the shared process-wide generator', () => {
    const ids = Array.from({ length: 1000 }, () => uuid7());
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toStrictEqual(ids);
  });

  it('randomises the last 62 bits', () => {
    const next = createUuid7(() => 1_789_000_000_000);
    const tails = new Set(Array.from({ length: 200 }, () => next().slice(19)));
    expect(tails.size).toBe(200);
  });
});
