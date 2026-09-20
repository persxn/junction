import type { JobOutcome, JobTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { JobStateRow } from '../db/schema/index.js';
import { applyOutcome } from './outcome.js';
import type { JobStore } from './store.js';
import type { JobContext, JobRunResult, RegisteredJob } from './types.js';
import type { Clock } from '../platform/time.js';

export interface ExecuteRunOptions {
  readonly job: RegisteredJob;
  /** The row as it was when the lease was claimed. */
  readonly row: JobStateRow;
  readonly trigger: JobTrigger;
  /** When the lease was taken, i.e. the start of the duration measurement. */
  readonly at: Date;
  readonly store: JobStore;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly random: () => number;
  /** Aborted when the backend is shutting down. */
  readonly signal: AbortSignal;
}

/**
 * Runs one job and writes its bookkeeping. Kept apart from the scheduler because
 * this is where a job's misbehaviour has to be absorbed: whatever it throws, the
 * lease is released and exactly one `job finished` line is logged (ruling R11's
 * one-line-per-unit-of-work habit), so a broken job can never stall the tick or
 * leave the row claimed.
 *
 * The returned promise never rejects; the outcome is the answer.
 */
export async function executeRun(options: ExecuteRunOptions): Promise<JobOutcome> {
  const { job, row, trigger, at, store, clock, signal } = options;
  const logger = options.logger.child({ job: job.key, trigger });
  const context: JobContext = {
    key: job.key,
    trigger,
    attempt: row.consecutiveFailures + 1,
    signal,
    logger,
    clock,
    state: row,
  };

  let outcome: JobOutcome;
  let result: JobRunResult | undefined;
  let errorMessage: string | undefined;
  try {
    result = (await job.definition.run(context)) ?? undefined;
    outcome = result?.outcome ?? 'SUCCESS';
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    // A run that threw *because* it was asked to stop is not a failing job, so
    // it must not earn a backoff.
    outcome = signal.aborted ? 'ABORTED' : 'FAILED';
    if (outcome === 'FAILED') {
      logger.error({ err: error }, 'job failed');
    }
  }
  if (outcome !== 'ABORTED' && signal.aborted) {
    // It returned rather than threw, but it was told to stop part-way: its work
    // is not trustworthy, so the schedule is not moved forward.
    outcome = 'ABORTED';
  }

  const finishedAt = clock.now();
  const patch = applyOutcome({
    outcome,
    previous: row,
    job,
    at: finishedAt,
    durationMs: finishedAt.getTime() - at.getTime(),
    random: options.random,
    ...(result?.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  });
  store.finish(job.key, patch);

  logger.info(
    {
      outcome,
      ms: patch.lastDurationMs,
      consecutiveFailures: patch.consecutiveFailures,
      nextDueAt: patch.nextDueAt,
      ...(result?.detail === undefined ? {} : { detail: result.detail }),
    },
    'job finished',
  );
  return outcome;
}
