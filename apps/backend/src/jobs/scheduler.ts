import type { JobKind, JobOutcome, JobTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { JobStateRow } from '../db/schema/index.js';
import type { ShutdownRegistry } from '../platform/shutdown.js';
import { applyOutcome } from './outcome.js';
import { executeRun } from './run.js';
import { isLeaseExpired } from '../domain/scheduling.js';
import { firstDueAt } from '../domain/jobs/schedule.js';
import { JobStore } from './store.js';
import {
  DEFAULT_CONCURRENCY_LIMITS,
  DEFAULT_DRAIN_TIMEOUT_MS,
  registerable,
  TICK_INTERVAL_MS,
  type JobDefinition,
  type RegisteredJob,
  type TickSummary,
  type TriggerResult,
} from './types.js';
import { systemClock, type Clock } from '../platform/time.js';

export interface SchedulerOptions {
  readonly store: JobStore;
  readonly logger: Logger;
  /** Injected in tests; every scheduling decision reads this, never a counter. */
  readonly clock?: Clock;
  /** Injected in tests so jitter is deterministic. */
  readonly random?: () => number;
  readonly tickIntervalMs?: number;
  readonly limits?: Partial<Record<JobKind, number>>;
  /**
   * Offline detection for jobs that need the network (D-23). Awaited once per
   * tick, and only when a due job actually asks for it.
   */
  readonly isOnline?: () => boolean | Promise<boolean>;
  /** The `resources` shutdown hook is registered here (ruling R14). */
  readonly shutdown?: ShutdownRegistry;
  readonly drainTimeoutMs?: number;
}

interface InFlight {
  readonly kind: JobKind;
  readonly finished: Promise<JobOutcome>;
}

/**
 * The DB-backed job runner from ARCHITECTURE.md §4.9 / ADR-0008.
 *
 * Nothing about the schedule lives in memory: a tick asks the database which
 * jobs are due and runs them. That is what makes a restart, a closed laptop lid
 * or a two-day gap catch up on its own, and why the tick is cheap enough to fire
 * every 30 seconds forever.
 *
 * `tick()` is public and returns as soon as the due jobs have been *started*, so
 * tests drive time themselves (advance the injected clock, tick, `drain()`)
 * instead of waiting on real timers.
 */
export class Scheduler {
  readonly #store: JobStore;
  readonly #logger: Logger;
  readonly #clock: Clock;
  readonly #random: () => number;
  readonly #tickIntervalMs: number;
  readonly #limits: Readonly<Record<JobKind, number>>;
  readonly #isOnline: () => boolean | Promise<boolean>;
  readonly #drainTimeoutMs: number;

  readonly #jobs = new Map<string, RegisteredJob>();
  readonly #inFlight = new Map<string, InFlight>();
  readonly #abort = new AbortController();
  #timer: NodeJS.Timeout | undefined;
  #started = false;
  #stopped = false;

  constructor(options: SchedulerOptions) {
    this.#store = options.store;
    this.#logger = options.logger.child({ component: 'scheduler' });
    this.#clock = options.clock ?? systemClock;
    this.#random = options.random ?? Math.random;
    this.#tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
    this.#limits = { ...DEFAULT_CONCURRENCY_LIMITS, ...options.limits };
    this.#isOnline = options.isOnline ?? ((): boolean => true);
    this.#drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    options.shutdown?.register('resources', 'scheduler', () => this.stop('shutdown'));
  }

  /**
   * Adds a job and makes sure it has a `job_state` row. Registering the same key
   * twice is a programming error: two definitions would fight over one row.
   */
  register(definition: JobDefinition): void {
    const job = registerable(definition);
    if (this.#jobs.has(job.key)) {
      throw new Error(`Job "${job.key}" is already registered.`);
    }
    this.#jobs.set(job.key, job);
    const row = this.#store.ensure(job, firstDueAt(job, this.#clock.now(), this.#random));
    this.#logger.debug(
      { job: job.key, kind: job.kind, nextDueAt: row.nextDueAt },
      'job registered',
    );
  }

  registered(): readonly string[] {
    return [...this.#jobs.keys()];
  }

  /** Makes these jobs due now, backoff cleared (earned before setup), and ticks. */
  makeDueNow(keys: readonly string[]): void {
    const atMs = this.#clock.now().getTime();
    for (const key of keys.filter((candidate) => this.#jobs.has(candidate))) {
      this.#store.makeDue(key, atMs);
    }
    if (this.#started && !this.#stopped) {
      void this.tick('SCHEDULE').catch((error: unknown) => {
        this.#logger.error({ err: error }, 'scheduler tick failed');
      });
    }
  }

  /** Current `job_state` rows, for diagnostics and the later admin screen. */
  snapshot(): readonly ReturnType<typeof JobStore.toSnapshot>[] {
    return this.#store.all().map((row) => JobStore.toSnapshot(row));
  }

  /**
   * Starts ticking. The first tick runs immediately and is tagged
   * `STARTUP_CATCHUP`, because everything it finds due was missed while this
   * backend was not running.
   */
  async start(): Promise<TickSummary> {
    if (this.#started) {
      throw new Error('The scheduler is already started.');
    }
    this.#started = true;
    this.#reclaimCrashedRuns();

    const summary = await this.tick('STARTUP_CATCHUP');
    this.#timer = setInterval(() => {
      void this.tick('SCHEDULE').catch((error: unknown) => {
        this.#logger.error({ err: error }, 'scheduler tick failed');
      });
    }, this.#tickIntervalMs);
    // A pending tick must never be the reason the process stays alive.
    this.#timer.unref();
    this.#logger.info(
      { jobs: this.#jobs.size, tickIntervalMs: this.#tickIntervalMs },
      'scheduler started',
    );
    return summary;
  }

  /**
   * One pass: reclaim expired leases, then start every due job the concurrency
   * limits allow. Returns once the runs are started, not finished.
   */
  async tick(trigger: JobTrigger = 'SCHEDULE'): Promise<TickSummary> {
    const at = this.#clock.now();
    const atMs = at.getTime();
    if (this.#stopped) {
      return { at: atMs, started: [], deferred: [], skippedOffline: [], reclaimed: [] };
    }

    const reclaimed = this.#reclaimExpiredLeases(atMs);
    const due = this.#store.due(atMs);

    const started: string[] = [];
    const deferred: string[] = [];
    const skippedOffline: string[] = [];
    let online: boolean | undefined;

    for (const row of due) {
      const job = this.#jobs.get(row.jobKey);
      // A row whose job this build no longer registers is left alone, not deleted:
      // an older or newer backend may own it.
      if (job === undefined || this.#inFlight.has(row.jobKey)) {
        continue;
      }
      if (this.#atCapacity(job.kind)) {
        deferred.push(job.key);
        continue;
      }
      if (job.definition.requiresNetwork === true) {
        online ??= await this.#isOnline();
        if (!online) {
          this.#recordSkippedOffline(job, row, at);
          skippedOffline.push(job.key);
          continue;
        }
      }
      if (!this.#store.claim(job.key, atMs)) {
        // Somebody took the lease between the query and here; nothing to do.
        continue;
      }
      void this.#launch(job, row, trigger, at);
      started.push(job.key);
    }

    const summary: TickSummary = { at: atMs, started, deferred, skippedOffline, reclaimed };
    if (started.length + deferred.length + skippedOffline.length + reclaimed.length > 0) {
      this.#logger.debug({ ...summary, trigger }, 'scheduler tick');
    }
    return summary;
  }

  /**
   * Runs a job now, outside its schedule: the manual "Refresh" button. Per-source
   * manual floors (D-27) are the caller's business; this enforces only
   * single-flight, the concurrency limits and, unless forced, the backoff.
   */
  trigger(key: string, options: { force?: boolean } = {}): TriggerResult {
    if (this.#stopped) {
      return { accepted: false, reason: 'STOPPED' };
    }
    const job = this.#jobs.get(key);
    if (job === undefined) {
      return { accepted: false, reason: 'UNKNOWN_JOB' };
    }
    if (this.#inFlight.has(key)) {
      return { accepted: false, reason: 'ALREADY_RUNNING' };
    }
    if (this.#atCapacity(job.kind)) {
      return { accepted: false, reason: 'AT_CAPACITY' };
    }

    const at = this.#clock.now();
    const atMs = at.getTime();
    let row = this.#store.read(key);
    if (row === undefined) {
      return { accepted: false, reason: 'UNKNOWN_JOB' };
    }
    if (row.backoffUntil !== null && row.backoffUntil > atMs) {
      if (options.force !== true) {
        return { accepted: false, reason: 'IN_BACKOFF' };
      }
      this.#store.clearBackoff(key);
      row = this.#store.read(key) ?? row;
    }
    if (!this.#store.claim(key, atMs)) {
      return { accepted: false, reason: 'ALREADY_RUNNING' };
    }
    return { accepted: true, finished: this.#launch(job, row, 'MANUAL', at) };
  }

  /** Resolves once every in-flight run has finished its bookkeeping. */
  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight.values()].map((entry) => entry.finished));
    }
  }

  /**
   * Stops ticking, asks in-flight runs to abort and waits a bounded time for
   * them. Registered as the `resources` shutdown hook (R14), so it runs after the
   * HTTP server is closed and before the database is shut. Idempotent.
   */
  async stop(reason: string): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#abort.abort(new Error(`scheduler stopping: ${reason}`));

    const abandoned = await this.#drainWithTimeout();
    this.#logger.info({ reason, abandoned }, 'scheduler stopped');
  }

  async #drainWithTimeout(): Promise<readonly string[]> {
    if (this.#inFlight.size === 0) {
      return [];
    }
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.#drainTimeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([this.drain(), expired]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    const abandoned = [...this.#inFlight.keys()];
    if (abandoned.length > 0) {
      // Their leases stay in the database on purpose: the next start finds them
      // and records a CRASHED run instead of pretending nothing happened.
      this.#logger.warn(
        { jobs: abandoned, drainTimeoutMs: this.#drainTimeoutMs },
        'jobs still running at shutdown; their leases will be reclaimed on the next start',
      );
    }
    return abandoned;
  }

  #atCapacity(kind: JobKind): boolean {
    let running = 0;
    for (const entry of this.#inFlight.values()) {
      if (entry.kind === kind) {
        running += 1;
      }
    }
    return running >= this.#limits[kind];
  }

  /**
   * Ruling R15 guarantees one backend per data directory, so any lease still in
   * the table when this process starts belonged to one that is gone.
   */
  #reclaimCrashedRuns(): void {
    const at = this.#clock.now();
    for (const row of this.#store.running()) {
      this.#reclaim(row, at, 'the backend stopped while this job was running');
    }
  }

  /** Runtime safety net: a lease held longer than the job's allowance. */
  #reclaimExpiredLeases(atMs: number): readonly string[] {
    const reclaimed: string[] = [];
    for (const row of this.#store.running()) {
      const job = this.#jobs.get(row.jobKey);
      if (job === undefined || this.#inFlight.has(row.jobKey)) {
        continue;
      }
      if (isLeaseExpired(row, job.leaseMs, atMs)) {
        this.#reclaim(row, new Date(atMs), `the lease expired after ${job.leaseMs.toString()} ms`);
        reclaimed.push(row.jobKey);
      }
    }
    return reclaimed;
  }

  #reclaim(row: JobStateRow, at: Date, message: string): void {
    const job = this.#jobs.get(row.jobKey);
    if (job === undefined) {
      return;
    }
    this.#store.finish(
      row.jobKey,
      applyOutcome({
        outcome: 'CRASHED',
        previous: row,
        job,
        at,
        durationMs: Math.max(0, at.getTime() - (row.runningSince ?? at.getTime())),
        random: this.#random,
        errorMessage: message,
      }),
    );
    this.#logger.warn(
      { job: row.jobKey, runningSince: row.runningSince, reason: message },
      'stale job lease reclaimed',
    );
  }

  /** Records a due-but-offline job without ever calling it (D-23). */
  #recordSkippedOffline(job: RegisteredJob, row: JobStateRow, at: Date): void {
    this.#store.finish(
      job.key,
      applyOutcome({
        outcome: 'SKIPPED_OFFLINE',
        previous: row,
        job,
        at,
        durationMs: 0,
        random: this.#random,
      }),
    );
    this.#logger.info({ job: job.key, outcome: 'SKIPPED_OFFLINE' }, 'job skipped: offline');
  }

  /** Starts the run and registers it as in-flight. The promise never rejects. */
  #launch(
    job: RegisteredJob,
    row: JobStateRow,
    trigger: JobTrigger,
    at: Date,
  ): Promise<JobOutcome> {
    const finished = executeRun({
      job,
      row,
      trigger,
      at,
      store: this.#store,
      logger: this.#logger,
      clock: this.#clock,
      random: this.#random,
      signal: this.#abort.signal,
    }).finally(() => {
      this.#inFlight.delete(job.key);
    });
    this.#inFlight.set(job.key, { kind: job.kind, finished });
    return finished;
  }
}
