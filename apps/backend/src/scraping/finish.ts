import type { ScrapeOutcome, ScrapeTrigger } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { ScrapeRunRow, SourceRow } from '../db/schema/index.js';
import { backoffDelayMs } from '../domain/scheduling.js';
import { DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS } from '../jobs/types.js';
import type { SourceRecordsRepository } from '../modules/sources/records.js';
import type { SourcesRepository, RunTotals } from '../modules/sources/repository.js';
import { nowMs, type Clock } from '../platform/time.js';
import type { RunFailure } from './errors.js';
import { pausesSource } from './errors.js';
import type { SessionHooks } from './sessions.js';
import { countBlocks, recordRefusedKey, recordRefusedSession } from './standing.js';
import type { SnapshotStore } from './snapshots.js';

/**
 * How a scrape run ends (§7.6, §7.7) — every path that writes a finished
 * `scrape_runs` row, and the announcement ruling R86 puts on it.
 *
 * It is a file of its own because "what the run did" and "what closing it means"
 * are different questions. `run.ts` walks a listing; this decides which outcome
 * that walk earned, what it does to `source_state`, and who is told. Splitting
 * them also kept `run.ts` inside the 400-line cap when R86 arrived.
 */

/**
 * What closing a run needs. A subset of `run.ts`'s dependencies on purpose:
 * nothing here makes a request, so the HTTP client and the adapter are not in
 * scope and cannot be reached from here by accident.
 */
export interface RunCloseDependencies {
  readonly sources: SourcesRepository;
  readonly records: SourceRecordsRepository;
  readonly snapshots?: SnapshotStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** WP-14/R74: the professor's own session, and what a refusal does to it. */
  readonly sessions?: SessionHooks;
  /**
   * R86: every closed run is announced, so the freshness pill can stop polling.
   * Optional because a run is not the publisher's business — a backend with no
   * stream (a test, a one-off script) runs exactly the same.
   */
  readonly onRunFinished?: (event: RunFinished) => void;
}

/**
 * What a finished run tells every open client (ruling R86).
 *
 * It carries the three things a freshness surface needs and nothing more: which
 * source, how it went, and when. Counts and error details are in `scrape_runs`
 * and in Source status, which is what the UI re-reads once this arrives — an
 * event that carried them would be a second copy of the truth, going stale the
 * moment a detail-refresh pass moved something.
 */
export interface RunFinished {
  readonly sourceKey: string;
  readonly outcome: ScrapeOutcome;
  readonly finishedAt: number;
}

/** The five per-run item counters §7.7's row carries. */
export interface Counters {
  itemsSeen: number;
  itemsNew: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  itemsInvalid: number;
}

/** Bumps the counter an upsert outcome belongs to. */
export function count(counters: Counters, outcome: 'NEW' | 'UPDATED' | 'UNCHANGED'): void {
  if (outcome === 'NEW') {
    counters.itemsNew += 1;
  } else if (outcome === 'UPDATED') {
    counters.itemsUpdated += 1;
  } else {
    counters.itemsUnchanged += 1;
  }
}

/**
 * Tells whoever is listening that a run ended (R86).
 *
 * Wrapped, because a subscriber writing to a socket that has just gone away is
 * not a reason for the scrape to fail: the run is already committed, and losing
 * the announcement costs the pill its 5-minute poll and nothing else.
 */
function announce(deps: RunCloseDependencies, sourceKey: string, row: ScrapeRunRow): void {
  if (deps.onRunFinished === undefined) {
    return;
  }
  try {
    deps.onRunFinished({
      sourceKey,
      outcome: row.outcome,
      finishedAt: row.finishedAt ?? nowMs(deps.clock),
    });
  } catch (error) {
    deps.logger.warn({ err: error, source: sourceKey }, 'announcing the finished run failed');
  }
}

/** A run that never started: no requests, no state change, but a row all the same. */
export function closeImmediately(
  deps: RunCloseDependencies,
  source: SourceRow,
  trigger: ScrapeTrigger,
  startedAt: number,
  outcome: Extract<ScrapeOutcome, 'BLOCKED_BY_POLICY' | 'SKIPPED_OFFLINE' | 'SKIPPED_BACKOFF'>,
  failure: RunFailure | undefined,
): ScrapeRunRow {
  const run = deps.sources.openRun(source.id, trigger, startedAt);
  const totals: RunTotals = {
    outcome,
    errorKind: failure?.kind ?? null,
    errorDetail: failure?.message ?? null,
    listingComplete: false,
    requestsMade: 0,
    itemsSeen: 0,
    itemsNew: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    itemsInvalid: 0,
  };
  deps.logger.info({ source: source.key, outcome }, 'scrape run skipped');
  const row = deps.sources.closeRun(run.id, nowMs(deps.clock), startedAt, totals);
  // A skipped run is a finished run: it moves `last_run_at` for the sources the
  // status view lists, so the pill has to hear about it too.
  announce(deps, source.key, row);
  return row;
}

export interface FinishInput {
  readonly source: SourceRow;
  readonly run: ScrapeRunRow;
  readonly startedAt: number;
  readonly counters: Counters;
  readonly listingComplete: boolean;
  /** Some detail was owed and not fetched; the walk may still be complete (§7.6). */
  readonly degraded: boolean;
  readonly failure: RunFailure | undefined;
  readonly requestsMade: number;
  /** R75: requests that carried the professor's session. */
  readonly signedInRequests: number;
  /** R80: the site refused the session during the run. */
  readonly sessionRejected: boolean;
  readonly robotsFetches: number;
}

/**
 * Closes the run, updates `source_state` and applies §7.6.
 *
 * Which outcome a run gets is the one decision worth reading twice. A refusal by
 * the gate is `BLOCKED_BY_POLICY`, never a failure. A failure that happened
 * after some items had already been written is `PARTIAL`, because the data that
 * did land is real. A clean walk that the adapter did not call complete is also
 * `PARTIAL`: §7.6 counts only complete runs towards MISSING, and a run that
 * stopped at a cap has not proved anything is gone.
 */
export function finish(deps: RunCloseDependencies, input: FinishInput): ScrapeRunRow {
  const { source, counters, failure } = input;
  const finishedAt = nowMs(deps.clock);
  const wrote = counters.itemsNew + counters.itemsUpdated + counters.itemsUnchanged > 0;

  let outcome: ScrapeOutcome;
  if (failure === undefined) {
    outcome = input.listingComplete && !input.degraded ? 'SUCCESS' : 'PARTIAL';
  } else if (failure.refusal !== undefined || (failure.credential !== undefined && !wrote)) {
    // R80: a refused credential with nothing read is the same state as a
    // missing one (WP-11) — the source is not readable until a person acts.
    outcome = 'BLOCKED_BY_POLICY';
  } else {
    outcome = wrote ? 'PARTIAL' : 'FAILED';
  }

  const row = deps.sources.closeRun(input.run.id, finishedAt, input.startedAt, {
    outcome,
    errorKind: failure?.kind ?? null,
    errorDetail: failure?.message ?? null,
    // A failed run never claims a complete walk, whatever the adapter reported
    // before it threw.
    listingComplete: failure === undefined && input.listingComplete,
    requestsMade: input.requestsMade,
    ...counters,
  });

  // R79 counts against the streak as it stood before this run.
  const before = deps.sources.state(source.id, input.startedAt);
  const standing = { sources: deps.sources, sessions: deps.sessions, logger: deps.logger };
  if (failure?.credential !== undefined) {
    // R80: the credential — not the site — stopped working. No backoff, no
    // streak, no R79 count; Source status says what to do about it.
    if (failure.credential === 'API_KEY') {
      recordRefusedKey(standing, source, failure, finishedAt);
    } else {
      deps.sources.recordBlocked(
        source.id,
        finishedAt,
        finishedAt + source.cadenceMinutes * 60_000,
        failure.kind,
        failure.message,
      );
    }
  } else if (outcome === 'FAILED' || outcome === 'BLOCKED_BY_POLICY') {
    const failures = before.consecutiveFailures + 1;
    const backoffUntil =
      finishedAt + backoffDelayMs(failures, DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS);
    deps.sources.recordFailure(
      source.id,
      finishedAt,
      backoffUntil,
      failure?.kind ?? 'UNKNOWN',
      failure?.message ?? 'The run failed.',
      failures,
    );
  } else {
    // R75: "the session last worked" is only true of a run that used it.
    if (input.signedInRequests > 0 && deps.sessions?.isActive(source) === true) {
      deps.sessions.verify(source, finishedAt);
    }
    const nextDueAt = finishedAt + source.cadenceMinutes * 60_000;
    // §7.6 again: PARTIAL updates `last_run_at` but is not proof the source is
    // healthy, so it does not stamp `last_success_at`.
    deps.sources.recordSuccess(source.id, finishedAt, nextDueAt, outcome === 'SUCCESS');
  }

  if (input.sessionRejected) {
    recordRefusedSession(standing, source, finishedAt);
  }
  countBlocks(standing, source, failure, before.consecutiveBlocked, finishedAt);

  // Only a complete run may age a record out (§7.6).
  const marked = row.listingComplete ? deps.records.markMissing(source.id, finishedAt) : 0;

  if (failure !== undefined && pausesSource(failure.kind)) {
    deps.sources.pause(source.id, finishedAt);
    deps.logger.warn(
      { source: source.key, kind: failure.kind },
      'the source format changed, so the source is paused until an administrator re-enables it',
    );
  }

  deps.snapshots?.prune();
  deps.logger.info(
    {
      source: source.key,
      outcome,
      errorKind: row.errorKind,
      listingComplete: row.listingComplete,
      requestsMade: row.requestsMade,
      robotsFetches: input.robotsFetches,
      items: counters,
      markedMissing: marked,
      durationMs: row.durationMs,
    },
    'scrape run finished',
  );
  announce(deps, source.key, row);
  return row;
}
