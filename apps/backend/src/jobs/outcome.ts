import { FAILING_JOB_OUTCOMES, type JobOutcome } from '@compintel/contracts';

import type { JobStateRow } from '../db/schema/index.js';
import { applyJitter, backoffDelayMs } from '../domain/scheduling.js';
import { nextDueAfterRun } from './schedule.js';
import type { RegisteredJob } from './types.js';

/** The columns a finished run rewrites. `runningSince` always goes back to NULL. */
export interface JobStatePatch {
  readonly lastRunAt: number;
  readonly lastSuccessAt: number | null;
  readonly nextDueAt: number;
  readonly consecutiveFailures: number;
  readonly backoffUntil: number | null;
  readonly lastOutcome: JobOutcome;
  readonly lastDurationMs: number;
  readonly lastErrorMessage: string | null;
}

export interface ApplyOutcomeOptions {
  readonly outcome: JobOutcome;
  /** The row as it was when the run was claimed. */
  readonly previous: JobStateRow;
  readonly job: RegisteredJob;
  readonly at: Date;
  readonly durationMs: number;
  readonly random: () => number;
  readonly retryAfterMs?: number;
  readonly errorMessage?: string;
}

/** Log messages never carry scraped content, only a bounded reason. */
const MAX_ERROR_MESSAGE = 500;

/**
 * The scheduler's state machine, as a pure function of the previous row and what
 * the run reported (§4.9).
 *
 * - `SUCCESS` / `PARTIAL` clear the failure streak; only `SUCCESS` stamps
 *   `last_success_at`, because a partial scrape has not proved the source is
 *   healthy (§7.6).
 * - `SKIPPED_OFFLINE` is explicitly **not** a failure (D-23): the job simply
 *   comes back at its normal cadence.
 * - `ABORTED` (shutdown) leaves `next_due_at` alone, so the job is still due the
 *   moment the backend is back - that is the catch-up path for an interrupted run.
 * - `FAILED` / `CRASHED` increment the streak and push both `backoff_until` and
 *   `next_due_at` out by the jittered exponential delay.
 */
export function applyOutcome(options: ApplyOutcomeOptions): JobStatePatch {
  const { outcome, previous, job, at, random } = options;
  const atMs = at.getTime();
  const base = {
    lastRunAt: atMs,
    lastOutcome: outcome,
    lastDurationMs: Math.max(0, Math.round(options.durationMs)),
    lastErrorMessage:
      options.errorMessage === undefined ? null : options.errorMessage.slice(0, MAX_ERROR_MESSAGE),
  };

  if (FAILING_JOB_OUTCOMES.includes(outcome)) {
    const consecutiveFailures = previous.consecutiveFailures + 1;
    const delay = applyJitter(
      backoffDelayMs(consecutiveFailures, job.backoffBaseMs, job.backoffMaxMs),
      job.jitterRatio,
      random,
    );
    const backoffUntil = atMs + delay;
    return {
      ...base,
      lastSuccessAt: previous.lastSuccessAt,
      nextDueAt: backoffUntil,
      consecutiveFailures,
      backoffUntil,
    };
  }

  if (outcome === 'ABORTED') {
    return {
      ...base,
      lastSuccessAt: previous.lastSuccessAt,
      // Deliberately unchanged: whatever was due before shutdown is still due.
      nextDueAt: previous.nextDueAt,
      consecutiveFailures: previous.consecutiveFailures,
      backoffUntil: previous.backoffUntil,
    };
  }

  const nextDueAt = nextDueAfterRun(job, previous, at, random, options.retryAfterMs);
  if (outcome === 'SKIPPED_OFFLINE') {
    return {
      ...base,
      lastSuccessAt: previous.lastSuccessAt,
      nextDueAt,
      // Not a failure, so the streak is left exactly as it was.
      consecutiveFailures: previous.consecutiveFailures,
      backoffUntil: previous.backoffUntil,
    };
  }

  return {
    ...base,
    lastSuccessAt: outcome === 'SUCCESS' ? atMs : previous.lastSuccessAt,
    nextDueAt,
    consecutiveFailures: 0,
    backoffUntil: null,
  };
}
