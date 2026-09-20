import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clock,
  deferred,
  schedulerHarness,
  testJob as job,
  MINUTE,
  T0,
  type SchedulerHarness,
} from '../testing/scheduler.js';
import type { JobContext } from './types.js';

const live: SchedulerHarness[] = [];

afterEach(async () => {
  while (live.length > 0) {
    await live.pop()?.close();
  }
});

function harness(options: Parameters<typeof schedulerHarness>[0] = {}): SchedulerHarness {
  const created = schedulerHarness(options);
  live.push(created);
  return created;
}

describe('Scheduler catch-up', () => {
  it('runs a job that came due while the backend was asleep, exactly once', async () => {
    const time = clock();
    const runs = vi.fn();
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job({ firstRun: 'after-interval', run: runs }));
    expect(store.read('j')?.nextDueAt).toBe(T0 + 15 * MINUTE);

    // Eight hours of sleep is 32 missed 15-minute cycles; the tick is a timestamp
    // comparison, so it is one overdue job, not 32 queued runs.
    time.advance(8 * 60 * MINUTE);
    const summary = await scheduler.tick();
    await scheduler.drain();

    expect(summary.started).toStrictEqual(['j']);
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('reschedules from when the run happened, so the cadence cannot drift', async () => {
    const time = clock();
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job({ firstRun: 'after-interval' }));

    time.advance(8 * 60 * MINUTE);
    await scheduler.tick();
    await scheduler.drain();

    expect(store.read('j')?.nextDueAt).toBe(T0 + 8 * 60 * MINUTE + 15 * MINUTE);
  });

  it('tags the first tick after a start as STARTUP_CATCHUP', async () => {
    const time = clock();
    const triggers: string[] = [];
    const { scheduler } = harness({ clock: time });
    scheduler.register(
      job({
        run: (context: JobContext) => {
          triggers.push(context.trigger);
        },
      }),
    );

    await scheduler.start();
    await scheduler.drain();
    expect(triggers).toStrictEqual(['STARTUP_CATCHUP']);
  });

  it('refuses to start twice', async () => {
    const { scheduler } = harness({ clock: clock() });
    await scheduler.start();
    await expect(scheduler.start()).rejects.toThrow(/already started/);
  });
});

describe('Scheduler single-flight', () => {
  it('never starts a second run of a job that is still going', async () => {
    const time = clock();
    const gate = deferred();
    const runs = vi.fn(() => gate.promise);
    const { scheduler } = harness({ clock: time });
    scheduler.register(job({ run: runs }));

    const first = await scheduler.tick();
    time.advance(60 * MINUTE);
    const second = await scheduler.tick();

    expect(first.started).toStrictEqual(['j']);
    expect(second.started).toStrictEqual([]);
    expect(runs).toHaveBeenCalledTimes(1);

    gate.resolve();
    await scheduler.drain();
  });

  it('holds the lease in the database, not just in memory', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job({ run: () => gate.promise }));

    await scheduler.tick();
    expect(store.read('j')?.runningSince).toBe(T0);

    gate.resolve();
    await scheduler.drain();
    expect(store.read('j')?.runningSince).toBeNull();
  });
});

describe('Scheduler stale leases', () => {
  it('reclaims a lease left behind by a crashed backend on the next start', async () => {
    const time = clock();
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job());
    // What a process killed mid-run leaves in the table (ruling R15 guarantees
    // the dead process was the only one that could have written it).
    store.claim('j', T0 - 5 * MINUTE);

    time.advance(MINUTE);
    await scheduler.start();
    await scheduler.drain();

    const row = store.read('j');
    expect(row?.lastOutcome).toBe('CRASHED');
    expect(row?.runningSince).toBeNull();
    expect(row?.consecutiveFailures).toBe(1);
    expect(row?.backoffUntil).toBe(T0 + MINUTE + 15 * MINUTE);
    expect(row?.lastErrorMessage).toMatch(/backend stopped/);
  });

  it('reclaims a lease that outlived its allowance while we are running', async () => {
    const time = clock();
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job({ leaseMs: 2 * MINUTE }));
    store.claim('j', T0);

    time.advance(MINUTE);
    expect((await scheduler.tick()).reclaimed).toStrictEqual([]);

    time.advance(2 * MINUTE);
    const summary = await scheduler.tick();
    expect(summary.reclaimed).toStrictEqual(['j']);
    expect(store.read('j')?.lastErrorMessage).toMatch(/lease expired/);
  });

  it('leaves a live lease alone', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job({ leaseMs: MINUTE, run: () => gate.promise }));

    await scheduler.tick();
    time.advance(10 * MINUTE);
    // The lease is stale by the clock, but this process knows the run is alive.
    expect((await scheduler.tick()).reclaimed).toStrictEqual([]);
    expect(store.read('j')?.runningSince).toBe(T0);

    gate.resolve();
    await scheduler.drain();
  });
});

describe('Scheduler backoff', () => {
  it('walks up the ladder and stays quiet in between', async () => {
    const time = clock();
    const runs = vi.fn(() => {
      throw new Error('source unreachable');
    });
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(job({ intervalMs: MINUTE, run: runs }));

    await scheduler.tick();
    await scheduler.drain();
    expect(store.read('j')?.consecutiveFailures).toBe(1);
    expect(store.read('j')?.nextDueAt).toBe(T0 + 15 * MINUTE);
    expect(store.read('j')?.lastErrorMessage).toBe('source unreachable');

    // Well past the 1-minute interval, but inside the 15-minute backoff.
    time.advance(5 * MINUTE);
    expect((await scheduler.tick()).started).toStrictEqual([]);

    time.advance(10 * MINUTE);
    expect((await scheduler.tick()).started).toStrictEqual(['j']);
    await scheduler.drain();
    expect(runs).toHaveBeenCalledTimes(2);
    expect(store.read('j')?.consecutiveFailures).toBe(2);
    expect(store.read('j')?.backoffUntil).toBe(T0 + 15 * MINUTE + 30 * MINUTE);
  });

  it('clears the streak as soon as a run succeeds', async () => {
    const time = clock();
    let fail = true;
    const { scheduler, store } = harness({ clock: time });
    scheduler.register(
      job({
        run: () => {
          if (fail) {
            throw new Error('nope');
          }
        },
      }),
    );

    await scheduler.tick();
    await scheduler.drain();
    fail = false;

    time.advance(20 * MINUTE);
    await scheduler.tick();
    await scheduler.drain();

    const row = store.read('j');
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.backoffUntil).toBeNull();
    expect(row?.lastSuccessAt).toBe(T0 + 20 * MINUTE);
  });

  it('tells the job which attempt this is', async () => {
    const time = clock();
    const attempts: number[] = [];
    const { scheduler } = harness({ clock: time });
    scheduler.register(
      job({
        run: (context: JobContext) => {
          attempts.push(context.attempt);
          throw new Error('nope');
        },
      }),
    );

    await scheduler.tick();
    await scheduler.drain();
    time.advance(20 * MINUTE);
    await scheduler.tick();
    await scheduler.drain();

    expect(attempts).toStrictEqual([1, 2]);
  });
});
