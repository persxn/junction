import { describe, expect, it } from 'vitest';

import {
  LOCKOUT_LADDER_MINUTES,
  LOCKOUT_THRESHOLD,
  LOGIN_RATE_LIMIT,
  LoginRateLimiter,
  lockoutMinutesFor,
} from './throttle.js';

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

describe('the process-wide limiter (ruling R34)', () => {
  function limiter(now: () => number): LoginRateLimiter {
    return new LoginRateLimiter({ now });
  }

  it('allows ten attempts a minute and refuses the eleventh', () => {
    const rate = limiter(() => 0);
    for (let index = 0; index < LOGIN_RATE_LIMIT; index += 1) {
      expect(rate.tryAcquire()).toBe(true);
    }
    expect(rate.tryAcquire()).toBe(false);
  });

  it('does not count a refused attempt, so hammering cannot extend the wait', () => {
    let now = 0;
    const rate = limiter(() => now);
    for (let index = 0; index < 10; index += 1) {
      rate.tryAcquire();
    }
    for (let index = 0; index < 50; index += 1) {
      expect(rate.tryAcquire()).toBe(false);
    }
    expect(rate.used()).toBe(10);
    now = 60_001;
    expect(rate.tryAcquire()).toBe(true);
  });

  it('slides rather than resetting on the minute', () => {
    let now = 0;
    const rate = limiter(() => now);
    for (let index = 0; index < 10; index += 1) {
      now = index * 1_000;
      rate.tryAcquire();
    }
    // 59 s after the first attempt: still nine in the window.
    now = 59_000;
    expect(rate.tryAcquire()).toBe(false);
    // Past the first one's minute: room for exactly one more.
    now = 60_001;
    expect(rate.tryAcquire()).toBe(true);
    expect(rate.tryAcquire()).toBe(false);
  });

  it('takes its own limit and window', () => {
    let now = 0;
    const rate = new LoginRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    expect(rate.tryAcquire()).toBe(true);
    expect(rate.tryAcquire()).toBe(true);
    expect(rate.tryAcquire()).toBe(false);
    now = 1_001;
    expect(rate.tryAcquire()).toBe(true);
  });
});
