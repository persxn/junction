import { JobSnapshot } from '@compintel/contracts';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShutdownRegistry } from '../platform/shutdown.js';
import {
  clock,
  deferred,
  schedulerHarness,
  testJob as job,
  MINUTE,
  T0,
  type SchedulerHarness,
} from '../testing/scheduler.js';
import { Scheduler } from './scheduler.js';
import { registerable, type JobContext } from './types.js';

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

describe('Scheduler offline handling', () => {
  it('skips a network job without calling it and without blaming it (D-23)', async () => {
    const time = clock();
    const runs = vi.fn();
    const { scheduler, store } = harness({ now: time.now, isOnline: () => false });
    scheduler.register(job({ requiresNetwork: true, run: runs }));

    const summary = await scheduler.tick();
    expect(summary.skippedOffline).toStrictEqual(['j']);
    expect(summary.started).toStrictEqual([]);
    expect(runs).not.toHaveBeenCalled();

    const row = store.read('j');
    expect(row?.lastOutcome).toBe('SKIPPED_OFFLINE');
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.backoffUntil).toBeNull();
    expect(row?.nextDueAt).toBe(T0 + 15 * MINUTE);
  });

  it('still runs jobs that do not need the network', async () => {
    const time = clock();
    const { scheduler } = harness({ now: time.now, isOnline: () => false });
    scheduler.register(job({ key: 'local' }));
    scheduler.register(job({ key: 'remote', requiresNetwork: true }));

    const summary = await scheduler.tick();
    expect(summary.started).toStrictEqual(['local']);
    expect(summary.skippedOffline).toStrictEqual(['remote']);
    await scheduler.drain();
  });

  it('asks once per tick, not once per job', async () => {
    const time = clock();
    const isOnline = vi.fn(() => true);
    const { scheduler } = harness({ now: time.now, isOnline });
    scheduler.register(job({ key: 'a', requiresNetwork: true }));
    scheduler.register(job({ key: 'b', requiresNetwork: true }));

    await scheduler.tick();
    await scheduler.drain();
    expect(isOnline).toHaveBeenCalledTimes(1);
  });
});

describe('Scheduler concurrency limits', () => {
  it('runs at most two scrapes at once and defers the rest (§4.9)', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler } = harness({ now: time.now });
    for (const key of ['s1', 's2', 's3']) {
      scheduler.register(job({ key, kind: 'SCRAPE', run: () => gate.promise }));
    }

    const summary = await scheduler.tick();
    expect(summary.started).toHaveLength(2);
    expect(summary.deferred).toHaveLength(1);

    gate.resolve();
    await scheduler.drain();

    // The deferred job is untouched, so the next tick simply picks it up.
    const next = await scheduler.tick();
    expect(next.started).toStrictEqual(summary.deferred);
    await scheduler.drain();
  });

  it('runs one LLM job at a time', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler } = harness({ now: time.now });
    scheduler.register(job({ key: 'l1', kind: 'LLM', run: () => gate.promise }));
    scheduler.register(job({ key: 'l2', kind: 'LLM', run: () => gate.promise }));

    const summary = await scheduler.tick();
    expect(summary.started).toHaveLength(1);
    expect(summary.deferred).toHaveLength(1);

    gate.resolve();
    await scheduler.drain();
  });

  it('keeps the pools separate', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler } = harness({ now: time.now, limits: { SCRAPE: 1, LLM: 1, GENERAL: 1 } });
    scheduler.register(job({ key: 'scrape', kind: 'SCRAPE', run: () => gate.promise }));
    scheduler.register(job({ key: 'llm', kind: 'LLM', run: () => gate.promise }));
    scheduler.register(job({ key: 'local', kind: 'GENERAL', run: () => gate.promise }));

    const summary = await scheduler.tick();
    expect([...summary.started].sort()).toStrictEqual(['llm', 'local', 'scrape']);

    gate.resolve();
    await scheduler.drain();
  });
});

describe('Scheduler manual trigger', () => {
  it('runs a job that is not due yet', async () => {
    const time = clock();
    const runs = vi.fn();
    const { scheduler } = harness({ now: time.now });
    scheduler.register(job({ firstRun: 'after-interval', run: runs }));

    const result = scheduler.trigger('j');
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(await result.finished).toBe('SUCCESS');
    }
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown job', () => {
    const { scheduler } = harness({ now: clock().now });
    expect(scheduler.trigger('nope')).toStrictEqual({ accepted: false, reason: 'UNKNOWN_JOB' });
  });

  it('refuses a job that is already running', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler } = harness({ now: time.now });
    scheduler.register(job({ run: () => gate.promise }));

    await scheduler.tick();
    expect(scheduler.trigger('j')).toStrictEqual({ accepted: false, reason: 'ALREADY_RUNNING' });

    gate.resolve();
    await scheduler.drain();
  });

  it('refuses a job that is backing off, unless it is forced', async () => {
    const time = clock();
    const runs = vi.fn(() => {
      throw new Error('nope');
    });
    const { scheduler, store } = harness({ now: time.now });
    scheduler.register(job({ run: runs }));

    await scheduler.tick();
    await scheduler.drain();
    expect(scheduler.trigger('j')).toStrictEqual({ accepted: false, reason: 'IN_BACKOFF' });

    const forced = scheduler.trigger('j', { force: true });
    expect(forced.accepted).toBe(true);
    if (forced.accepted) {
      await forced.finished;
    }
    expect(runs).toHaveBeenCalledTimes(2);
    // The forced attempt failed too, so the streak starts again from one.
    expect(store.read('j')?.consecutiveFailures).toBe(1);
  });
});

describe('Scheduler shutdown', () => {
  it('registers itself in the resources phase (ruling R14)', () => {
    const shutdown = new ShutdownRegistry();
    harness({ now: clock().now, shutdown });
    expect(shutdown.names('resources')).toStrictEqual(['scheduler']);
  });

  it('aborts a running job and leaves it due for the next start', async () => {
    const time = clock();
    const { scheduler, store } = harness({ now: time.now });
    scheduler.register(
      job({
        firstRun: 'immediate',
        run: (context: JobContext) =>
          new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          }),
      }),
    );

    await scheduler.tick();
    const dueBefore = store.read('j')?.nextDueAt;
    await scheduler.stop('shutdown');

    const row = store.read('j');
    expect(row?.lastOutcome).toBe('ABORTED');
    expect(row?.runningSince).toBeNull();
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.nextDueAt).toBe(dueBefore);
  });

  it('gives up on a job that ignores the abort and lets the next start reclaim it', async () => {
    const time = clock();
    const gate = deferred();
    const { scheduler: first, store, database } = harness({ now: time.now, drainTimeoutMs: 5 });
    first.register(job({ run: () => gate.promise }));

    await first.tick();
    await first.stop('shutdown');
    // The lease is deliberately still there: the run is still out there somewhere.
    expect(store.read('j')?.runningSince).toBe(T0);

    // A second backend on the same data directory is exactly what happens after
    // the shell restarts a crashed one (R15 makes the old lease provably dead).
    time.advance(MINUTE);
    const second = new Scheduler({
      store,
      logger: pino({ enabled: false }),
      random: () => 0.5,
      now: time.now,
    });
    second.register(job());
    await second.start();
    await second.drain();
    await second.stop('test');
    expect(store.read('j')?.lastOutcome).toBe('CRASHED');
    expect(database.db.isHealthy()).toBe(true);

    gate.resolve();
    await first.drain();
  });

  it('does nothing on a tick or a trigger after it has stopped', async () => {
    const time = clock();
    const runs = vi.fn();
    const { scheduler } = harness({ now: time.now });
    scheduler.register(job({ run: runs }));

    await scheduler.stop('shutdown');
    expect((await scheduler.tick()).started).toStrictEqual([]);
    expect(scheduler.trigger('j')).toStrictEqual({ accepted: false, reason: 'STOPPED' });
    expect(runs).not.toHaveBeenCalled();
  });

  it('is idempotent, because two shutdown paths can race', async () => {
    const { scheduler } = harness({ now: clock().now });
    await scheduler.stop('first');
    await expect(scheduler.stop('second')).resolves.toBeUndefined();
  });
});

describe('Scheduler registration', () => {
  it('refuses two definitions for one key', () => {
    const { scheduler } = harness({ now: clock().now });
    scheduler.register(job());
    expect(() => {
      scheduler.register(job());
    }).toThrow(/already registered/);
  });

  it('lists what it is running and hands out contract-shaped snapshots', () => {
    const { scheduler } = harness({ now: clock().now });
    scheduler.register(job({ key: 'deadline-evaluator' }));
    scheduler.register(job({ key: 'scrape:ctftime', kind: 'SCRAPE' }));

    expect([...scheduler.registered()].sort()).toStrictEqual([
      'deadline-evaluator',
      'scrape:ctftime',
    ]);
    for (const snapshot of scheduler.snapshot()) {
      expect(() => JobSnapshot.parse(snapshot)).not.toThrow();
    }
  });

  it('leaves rows belonging to jobs this build does not know about alone', async () => {
    const time = clock();
    const { scheduler, store } = harness({ now: time.now });
    scheduler.register(job());
    store.ensure(registerable(job({ key: 'from-a-newer-build' })), T0 - MINUTE);

    const summary = await scheduler.tick();
    expect(summary.started).toStrictEqual(['j']);
    await scheduler.drain();
    expect(store.read('from-a-newer-build')?.lastOutcome).toBeNull();
  });
});
