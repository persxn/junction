import { describe, expect, it } from 'vitest';

import { UUID_V7_PATTERN, Uuid7, uuid7Timestamp } from './ids.js';

const VALID = '01931f2a-0000-7000-8000-000000000000';

describe('Uuid7', () => {
  it('accepts a canonical v7 id', () => {
    expect(Uuid7.parse(VALID)).toBe(VALID);
  });

  it.each(['8', '9', 'a', 'b'])('accepts the variant nibble %s', (nibble) => {
    expect(Uuid7.safeParse(`01931f2a-0000-7000-${nibble}000-000000000000`).success).toBe(true);
  });

  it.each(['0', '1', '7', 'c', 'd', 'e', 'f'])('rejects the variant nibble %s', (nibble) => {
    expect(Uuid7.safeParse(`01931f2a-0000-7000-${nibble}000-000000000000`).success).toBe(false);
  });

  it.each(['1', '4', '6', '8'])('rejects version %s', (version) => {
    expect(Uuid7.safeParse(`01931f2a-0000-${version}000-8000-000000000000`).success).toBe(false);
  });

  it.each([
    ['uppercase hex', '01931F2A-0000-7000-8000-000000000000'],
    ['no dashes', '01931f2a00007000800000000000000'],
    ['too short', '01931f2a-0000-7000-8000-00000000000'],
    ['too long', '01931f2a-0000-7000-8000-0000000000000'],
    ['not hex', '01931f2a-0000-7000-8000-00000000000z'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(Uuid7.safeParse(value).success).toBe(false);
  });

  it('exposes the pattern for reuse', () => {
    expect(UUID_V7_PATTERN.test(VALID)).toBe(true);
  });
});

describe('uuid7Timestamp', () => {
  it('reads the 48-bit millisecond timestamp back', () => {
    expect(uuid7Timestamp('00000000-0000-7000-8000-000000000000')).toBe(0);
    expect(uuid7Timestamp('00000000-0001-7000-8000-000000000000')).toBe(1);
    expect(uuid7Timestamp('ffffffff-ffff-7fff-bfff-ffffffffffff')).toBe(0xffffffffffff);
  });

  it('refuses anything that is not a v7 id', () => {
    expect(() => uuid7Timestamp('nope')).toThrow(TypeError);
  });
});
