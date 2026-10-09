import type { Scheduler } from '../../jobs/scheduler.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { StreamHub } from '../../platform/stream.js';
import type { Clock } from '../../platform/time.js';
import type { NotificationEngine } from '../notifications/engine.js';
import type { SearchService } from '../search/service.js';
import {
  EvaluationPhase,
  evaluateSavedSearches,
  registerSavedSearchEvaluator,
  triggerOnRunFinished,
  type EvaluationSummary,
  type SavedSearchEvaluatorDependencies,
} from './evaluator.js';
import { SavedSearchesRepository } from './repo.js';
import { SavedSearchService } from './service.js';

/**
 * WP-24's saved searches, wired once for `main.ts` and the tests: the owner's
 * CRUD, and the evaluator — registered as a job, and triggered after scrapes.
 */

export interface SavedSearchesModule {
  readonly repo: SavedSearchesRepository;
  readonly service: SavedSearchService;
  /** One evaluation now, outside the scheduler (tests). */
  evaluate(now: number): EvaluationSummary;
  /** Registers the job and subscribes to `source.run.finished`; returns the unsubscribe. */
  schedule(scheduler: Scheduler, hub: StreamHub): () => void;
}

export function createSavedSearchesModule(options: {
  readonly db: DatabaseHandle;
  readonly search: Pick<SearchService, 'matchingIds'>;
  readonly notifications: Pick<NotificationEngine, 'emit'>;
  readonly clock?: Clock;
}): SavedSearchesModule {
  const repo = new SavedSearchesRepository(options.db);
  const matchingIds = (userId: string, query: Parameters<SearchService['matchingIds']>[1]) =>
    options.search.matchingIds(userId, query);
  const deps: SavedSearchEvaluatorDependencies = {
    repo,
    matchingIds,
    notifications: options.notifications,
  };
  const phase = new EvaluationPhase();
  return {
    repo,
    service: new SavedSearchService({
      repo,
      matchingIds,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
    evaluate: (now) => evaluateSavedSearches(deps, now),
    schedule: (scheduler, hub) => {
      registerSavedSearchEvaluator(scheduler, deps, phase);
      return triggerOnRunFinished(hub, scheduler, phase);
    },
  };
}
