import { pino } from 'pino';

import { JobStore } from '../jobs/store.js';
import { Scheduler, type SchedulerOptions } from '../jobs/scheduler.js';
import type { JobDefinition } from '../jobs/types.js';
import type { Clock } from '../platform/time.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';

/** Fixed point in time every scheduler test measures from. */
export const T0 = Date.UTC(2026, 8, 20, 12, 0, 0);
export const MINUTE = 60_000;

/** A {@link Clock} the test moves by hand; the scheduler only ever reads it. */
export function clock(at = T0): Clock & { advance: (ms: number) => void } {
  let current = at;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** A promise a test resolves when it wants a job to finish. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = () => {
      settle();
    };
  });
  return { promise, resolve };
}

/** A trivially valid job definition; every field can be overridden. */
export function testJob(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return { key: 'j', intervalMs: 15 * MINUTE, run: () => undefined, ...overrides };
}

export interface SchedulerHarness {
  readonly scheduler: Scheduler;
  readonly store: JobStore;
  readonly database: MigratedDatabase;
  /** Stops the scheduler and removes the temporary data directory. */
  close: () => Promise<void>;
}

/**
 * A scheduler on a real migrated database, with the clock and the jitter under
 * the test's control (`random: () => 0.5` means "no jitter", so every expected
 * timestamp is exact).
 */
export function schedulerHarness(
  options: Omit<SchedulerOptions, 'store' | 'logger'> = {},
): SchedulerHarness {
  const database = openMigratedDatabase();
  const store = new JobStore(database.db);
  const scheduler = new Scheduler({
    store,
    logger: pino({ enabled: false }),
    random: () => 0.5,
    ...options,
  });
  return {
    scheduler,
    store,
    database,
    close: async () => {
      await scheduler.stop('test-teardown');
      database.close();
    },
  };
}
