import { describe, expect, it } from 'vitest';

import { LOCKOUT_LADDER_MINUTES, LOCKOUT_THRESHOLD, lockoutMinutesFor } from './lockout.js';

describe('the lockout ladder (ruling R34)', () => {
  it('locks only on a multiple of five failures', () => {
    for (const count of [0, 1, 2, 3, 4, 6, 9, 11]) {
      expect(lockoutMinutesFor(count)).toBeUndefined();
    }
  });

  it('climbs 5 → 10 → 20 → 40 and caps at 60', () => {
    expect(lockoutMinutesFor(5)).toBe(5);
    expect(lockoutMinutesFor(10)).toBe(10);
    expect(lockoutMinutesFor(15)).toBe(20);
    expect(lockoutMinutesFor(20)).toBe(40);
    expect(lockoutMinutesFor(25)).toBe(60);
  });

  it('stays at the cap however long someone keeps going', () => {
    for (const count of [30, 100, 5_000]) {
      expect(lockoutMinutesFor(count)).toBe(LOCKOUT_LADDER_MINUTES.at(-1));
    }
  });

  it('ignores a negative or zero counter', () => {
    expect(lockoutMinutesFor(0)).toBeUndefined();
    expect(lockoutMinutesFor(-5)).toBeUndefined();
  });

  it('uses the threshold the ruling names', () => {
    expect(LOCKOUT_THRESHOLD).toBe(5);
    expect([...LOCKOUT_LADDER_MINUTES]).toStrictEqual([5, 10, 20, 40, 60]);
  });
});
