import { URGENCY_BUCKETS, type DueItem, type UrgencyBucket } from '@compintel/contracts';

import { nowMs } from '../../platform/time.js';
import type { Scheduler } from '../../jobs/scheduler.js';
import type { DeadlinesModule } from './wiring.js';

/**
 * The `deadline-evaluator` job (R22, D-23, WP-22): every five minutes, in the
 * GENERAL pool and **not** network-gated — deadlines fall due offline too —
 * it reads `v_deadlines` for every scope at once, buckets it with the same
 * `dueItems` the Radar uses, and hands the items to each registered
 * `DueItemSink`. WP-22 registers none and only logs the counts; WP-23's
 * notifications register here.
 */

export const DEADLINE_EVALUATOR_JOB_KEY = 'deadline-evaluator';
export const DEADLINE_EVALUATOR_INTERVAL_MS = 5 * 60_000;

export interface DueItemSink {
  /** For the log line. */
  readonly name: string;
  readonly consume: (
    items: readonly DueItem[],
    context: { readonly now: number },
  ) => void | Promise<void>;
}

const sinks: DueItemSink[] = [];

/** WP-23's seam. Returns a function that takes the sink back out (tests). */
export function registerDueItemSink(sink: DueItemSink): () => void {
  sinks.push(sink);
  return () => {
    const index = sinks.indexOf(sink);
    if (index >= 0) sinks.splice(index, 1);
  };
}

export function byBucket(items: readonly DueItem[]): Record<UrgencyBucket, number> {
  const counts = Object.fromEntries(URGENCY_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    UrgencyBucket,
    number
  >;
  for (const item of items) counts[item.bucket] += 1;
  return counts;
}

export function registerDeadlineEvaluator(scheduler: Scheduler, deadlines: DeadlinesModule): void {
  scheduler.register({
    key: DEADLINE_EVALUATOR_JOB_KEY,
    kind: 'GENERAL',
    intervalMs: DEADLINE_EVALUATOR_INTERVAL_MS,
    // D-23: it must run with the machine offline.
    requiresNetwork: false,
    run: async (context) => {
      const now = nowMs(context.clock);
      const items = deadlines.service.everything(now);
      const counts = byBucket(items);
      for (const sink of [...sinks]) await sink.consume(items, { now });
      context.logger.info(
        { items: items.length, byBucket: counts, sinks: sinks.length },
        'deadlines evaluated',
      );
      return { detail: `${String(items.length)} items` };
    },
  });
}
