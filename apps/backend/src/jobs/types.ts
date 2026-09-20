import type { JobKind, JobOutcome, JobTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { JobStateRow } from '../db/schema/index.js';

/**
 * The tick interval from §4.9. Everything else about scheduling is a timestamp
 * comparison, so this number only decides how *soon* a due job starts, never
 * whether it runs at all - which is why a slept or restarted machine catches up
 * without drift.
 */
export const TICK_INTERVAL_MS = 30_000;

/**
 * How long a run may hold its `running_since` lease before another tick treats
 * it as dead (§4.9 "stale-lock recovery"). Generous on purpose: a scrape with a
 * 10 s crawl-delay and dozens of requests is slow but healthy.
 */
export const DEFAULT_LEASE_MS = 15 * 60_000;

/** First backoff step; §7.2 gives 15 → 30 → 60 min … for sources (D-28). */
export const DEFAULT_BACKOFF_BASE_MS = 15 * 60_000;

/** Ceiling of the doubling, also from §7.2. */
export const DEFAULT_BACKOFF_MAX_MS = 12 * 3_600_000;

/**
 * Jitter as a fraction of the interval (§4.9). ±10 % keeps several sources that
 * were all seeded at install time from marching in lockstep forever.
 */
export const DEFAULT_JITTER_RATIO = 0.1;

/** Global limits from §4.9: 2 concurrent scrapes, 1 LLM job. */
export const DEFAULT_CONCURRENCY_LIMITS: Readonly<Record<JobKind, number>> = {
  SCRAPE: 2,
  LLM: 1,
  GENERAL: 4,
};

/** How long `stop()` waits for in-flight runs before leaving them behind. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

/** What a job's `run` is handed. */
export interface JobContext {
  readonly key: string;
  readonly trigger: JobTrigger;
  /** 1 for a first attempt, 2 after one consecutive failure, and so on. */
  readonly attempt: number;
  /** Aborted when the backend starts shutting down; long jobs must honour it. */
  readonly signal: AbortSignal;
  /** Child logger already tagged with the job key and trigger. */
  readonly logger: Logger;
  readonly now: () => Date;
  /** The row as it was when the run was claimed. */
  readonly state: JobStateRow;
}

/**
 * What a job may report back. Returning nothing means `SUCCESS`; the runner
 * derives everything else (failures, backoff, the next due time) from this.
 */
export interface JobRunResult {
  /** Only the outcomes a job can legitimately choose for itself. */
  readonly outcome?: Extract<JobOutcome, 'SUCCESS' | 'PARTIAL' | 'SKIPPED_OFFLINE'>;
  /** Overrides the computed next due time, e.g. to honour `Retry-After`. */
  readonly retryAfterMs?: number;
  /** Short, non-PII note for the log line. */
  readonly detail?: string;
}

/**
 * One scheduled job. Exactly one of `intervalMs` and `nextDueAt` must be given:
 * fixed cadences (`scrape:<source>`, `deadline-evaluator`, `health-snapshot`)
 * use the interval, while a job pinned to a wall-clock time (`backup:daily` at
 * 13:00 local, §14) computes its own next due date and therefore catches up by
 * itself when the machine was asleep.
 */
export interface JobDefinition {
  /** Stable identity and primary key, e.g. `scrape:ctftime`. */
  readonly key: string;
  /** Concurrency pool; defaults to `GENERAL`. */
  readonly kind?: JobKind;
  readonly intervalMs?: number;
  /** `previous` is the row before this run's bookkeeping was written. */
  readonly nextDueAt?: (from: Date, previous: JobStateRow) => number;
  /**
   * `immediate` (the default) makes a freshly registered job due at once, which
   * is what a first install wants. `after-interval` waits one interval first.
   */
  readonly firstRun?: 'immediate' | 'after-interval';
  /** Skipped as `SKIPPED_OFFLINE` while the machine has no network (D-23). */
  readonly requiresNetwork?: boolean;
  readonly leaseMs?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly jitterRatio?: number;
  readonly run: (context: JobContext) => Promise<JobRunResult | void> | JobRunResult | void;
}

/** A definition with every default filled in, which is what the runner holds. */
export interface RegisteredJob {
  readonly definition: JobDefinition;
  readonly key: string;
  readonly kind: JobKind;
  readonly leaseMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  readonly jitterRatio: number;
}

/** Why `trigger()` declined to start a run. */
export const TRIGGER_REFUSALS = [
  'UNKNOWN_JOB',
  'ALREADY_RUNNING',
  'AT_CAPACITY',
  'IN_BACKOFF',
  'STOPPED',
] as const;
export type TriggerRefusal = (typeof TRIGGER_REFUSALS)[number];

export type TriggerResult =
  | { readonly accepted: true; readonly finished: Promise<JobOutcome> }
  | { readonly accepted: false; readonly reason: TriggerRefusal };

/** What one tick did, for the tests and the debug log. */
export interface TickSummary {
  readonly at: number;
  readonly started: readonly string[];
  /** Due, but a concurrency limit was reached; retried next tick untouched. */
  readonly deferred: readonly string[];
  /** Due, but the machine is offline and the job needs the network. */
  readonly skippedOffline: readonly string[];
  /** Leases reclaimed from a process that died mid-run. */
  readonly reclaimed: readonly string[];
}

/** Fills in the per-job defaults. Throws on a definition that cannot schedule. */
export function registerable(definition: JobDefinition): RegisteredJob {
  if (definition.key.trim().length === 0) {
    throw new TypeError('A job needs a non-empty key.');
  }
  const hasInterval = definition.intervalMs !== undefined;
  const hasCustom = definition.nextDueAt !== undefined;
  if (hasInterval === hasCustom) {
    throw new TypeError(
      `Job "${definition.key}" must set exactly one of intervalMs and nextDueAt.`,
    );
  }
  if (definition.intervalMs !== undefined && definition.intervalMs <= 0) {
    throw new TypeError(`Job "${definition.key}" has a non-positive intervalMs.`);
  }
  return {
    definition,
    key: definition.key,
    kind: definition.kind ?? 'GENERAL',
    leaseMs: definition.leaseMs ?? DEFAULT_LEASE_MS,
    backoffBaseMs: definition.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs: definition.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS,
    jitterRatio: definition.jitterRatio ?? DEFAULT_JITTER_RATIO,
  };
}
