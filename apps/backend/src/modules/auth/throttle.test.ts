import { describe, expect, it } from 'vitest';

import { LOGIN_RATE_LIMIT, LoginRateLimiter } from './throttle.js';

describe('the process-wide limiter (ruling R34)', () => {
  function limiter(now: () => number): LoginRateLimiter {
    return new LoginRateLimiter({ clock: { now: () => new Date(now()) } });
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
    const rate = new LoginRateLimiter({
      limit: 2,
      windowMs: 1_000,
      clock: { now: () => new Date(now) },
    });
    expect(rate.tryAcquire()).toBe(true);
    expect(rate.tryAcquire()).toBe(true);
    expect(rate.tryAcquire()).toBe(false);
    now = 1_001;
    expect(rate.tryAcquire()).toBe(true);
  });
});
