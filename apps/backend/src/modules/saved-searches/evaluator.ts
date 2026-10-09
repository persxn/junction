import type { Logger } from 'pino';

import {
  diffMatches,
  newMatchNotification,
  resultHash,
} from '../../domain/saved-searches/matches.js';
import type { Scheduler } from '../../jobs/scheduler.js';
import { AppError } from '../../platform/errors.js';
import type { StreamHub } from '../../platform/stream.js';
import { nowMs } from '../../platform/time.js';
import type { NotificationEngine } from '../notifications/engine.js';
import type { SavedSearchesRepository } from './repo.js';
import { parseStoredQuery, type MatchingIds } from './service.js';

/**
 * The `saved-search-evaluator` job (R22, R112, WP-24): GENERAL, hourly, not
 * network-gated (the corpus is local), and triggered after every scrape run
 * that finished SUCCESS or PARTIAL (R86) — a run that fetched nothing cannot
 * have produced a match.
 *
 * One run, per search whose owner is active and whose query still parses:
 * ids-only search → hash → unchanged? stop · else diff against the remembered
 * set, add the new ids, and — with alerts on — emit **one** NEW_MATCH through
 * WP-23's `emit`, which honours the owner's preferences. The set advances
 * either way, so turning alerts back on does not replay the backlog.
 */

export const SAVED_SEARCH_EVALUATOR_JOB_KEY = 'saved-search-evaluator';
export const SAVED_SEARCH_EVALUATOR_INTERVAL_MS = 60 * 60_000;

/** Scrape outcomes that may have brought new events in. */
const TRIGGERING_OUTCOMES: ReadonlySet<unknown> = new Set(['SUCCESS', 'PARTIAL']);

export interface EvaluationSummary {
  readonly searches: number;
  readonly changed: number;
  readonly notified: number;
  readonly skipped: number;
}

export interface SavedSearchEvaluatorDependencies {
  readonly repo: SavedSearchesRepository;
  readonly matchingIds: MatchingIds;
  readonly notifications: Pick<NotificationEngine, 'emit'>;
}

export function evaluateSavedSearches(
  deps: SavedSearchEvaluatorDependencies,
  now: number,
  logger?: Logger,
): EvaluationSummary {
  let changed = 0;
  let notified = 0;
  let skipped = 0;
  const searches = deps.repo.evaluable();
  for (const search of searches) {
    const query = parseStoredQuery(search.queryJson);
    if (query === null) {
      skipped += 1;
      continue;
    }
    let ids: string[];
    try {
      ids = deps.matchingIds(search.userId, query);
    } catch (error) {
      // A query the planner now refuses (the campus lost its coordinates, say)
      // is skipped, not fatal: the other searches still run.
      if (!(error instanceof AppError)) throw error;
      logger?.warn({ savedSearchId: search.id, code: error.code }, 'saved search not evaluable');
      skipped += 1;
      continue;
    }
    const hash = resultHash(ids);
    if (hash === search.lastResultHash) {
      deps.repo.markEvaluated(search.id, now, hash);
      continue;
    }
    changed += 1;
    const fresh = deps.repo.transaction(() => {
      const added = diffMatches(deps.repo.matchSet(search.id), ids);
      deps.repo.addMatches(search.id, added, now);
      deps.repo.markEvaluated(search.id, now, hash);
      return added;
    });
    if (fresh.length === 0 || !search.notifyOnNew) continue;
    const notification = newMatchNotification(search, deps.repo.titles(fresh));
    const created = deps.notifications.emit(
      { type: 'NEW_MATCH', recipients: [search.userId], ...notification },
      now,
    );
    notified += created.length;
  }
  return { searches: searches.length, changed, notified, skipped };
}

/**
 * Whether the current evaluation has read the corpus yet — what decides if a
 * run announced during it is already covered (see `triggerOnRunFinished`).
 */
export class EvaluationPhase {
  #read = false;

  begin(): void {
    this.#read = false;
  }

  end(): void {
    this.#read = true;
  }

  get evaluated(): boolean {
    return this.#read;
  }
}

export function registerSavedSearchEvaluator(
  scheduler: Scheduler,
  deps: SavedSearchEvaluatorDependencies,
  phase: EvaluationPhase,
): void {
  scheduler.register({
    key: SAVED_SEARCH_EVALUATOR_JOB_KEY,
    kind: 'GENERAL',
    intervalMs: SAVED_SEARCH_EVALUATOR_INTERVAL_MS,
    requiresNetwork: false,
    run: (context) => {
      phase.begin();
      const summary = evaluateSavedSearches(deps, nowMs(context.clock), context.logger);
      phase.end();
      context.logger.info({ ...summary }, 'saved searches evaluated');
      return { detail: `${String(summary.searches)} searches, ${String(summary.notified)} alerts` };
    },
  });
}

/**
 * Runs the evaluator after each scrape run that finished SUCCESS or PARTIAL
 * (R86), listening in-process on the hub the run is announced on.
 *
 * Single-flight coalesces a burst: runs announced while an evaluation is in
 * flight are refused as ALREADY_RUNNING. The evaluation body is synchronous, so
 * a refusal before it has started is covered by it; one arriving after it read
 * the corpus (but before the runner's bookkeeping let go) is remembered and
 * answered with one more evaluation, so no run's events wait an hour.
 */
export function triggerOnRunFinished(
  hub: StreamHub,
  scheduler: Pick<Scheduler, 'trigger'>,
  phase: EvaluationPhase,
): () => void {
  let pending = false;
  const fire = (): void => {
    const result = scheduler.trigger(SAVED_SEARCH_EVALUATOR_JOB_KEY);
    if (result.accepted) {
      phase.begin();
      void result.finished.then(() => {
        if (!pending) return;
        pending = false;
        fire();
      });
    } else if (result.reason === 'ALREADY_RUNNING' && phase.evaluated) {
      pending = true;
    }
  };
  return hub.subscribe({
    send: (event) => {
      if (event.type !== 'source.run.finished') return;
      if (!TRIGGERING_OUTCOMES.has(event.payload.outcome)) return;
      fire();
    },
    close: () => undefined,
  });
}
