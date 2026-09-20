import { describe, expect, it } from 'vitest';

import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_BYTES,
} from './recovery-code.js';

/**
 * Ruling R41's one-time admin recovery code. It is read off a printout and typed
 * back months later by somebody who is already having a bad day, so the tests
 * are mostly about the alphabet being forgiving.
 */

describe('generateRecoveryCode', () => {
  it('is 32 bytes of Crockford base32 in groups of five', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{1,5})+$/);
    expect(code.replace(/-/g, '')).toHaveLength(Math.ceil((RECOVERY_CODE_BYTES * 8) / 5));
  });

  it('never uses the characters people confuse', () => {
    for (let round = 0; round < 50; round += 1) {
      expect(generateRecoveryCode()).not.toMatch(/[ILOU]/);
    }
  });

  it('is different every time', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(20);
  });

  it('encodes the bytes it was given', () => {
    const zeros = generateRecoveryCode(() => new Uint8Array(RECOVERY_CODE_BYTES));
    expect(zeros.replace(/-/g, '')).toMatch(/^0+$/);
  });
});

describe('normalizeRecoveryCode', () => {
  it('ignores case, dashes and spaces', () => {
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode('ABCDE FGHJK')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode('  abcde-fghjk  ')).toBe('ABCDEFGHJK');
  });

  it.each([
    ['I', '1'],
    ['l', '1'],
    ['O', '0'],
    ['o', '0'],
    ['U', 'V'],
  ])('folds %s to %s, the way Crockford says', (typed, meant) => {
    expect(normalizeRecoveryCode(typed)).toBe(meant);
  });

  it('normalizes a generated code to itself without the dashes', () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code)).toBe(code.replace(/-/g, ''));
  });
});
