import type { Logger } from 'pino';

import type { Scheduler } from '../../jobs/scheduler.js';
import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { CategoryAdminService } from './admin.js';
import { CategoriesRepository } from './repo.js';
import { CategoryClassifier } from './service.js';

/**
 * WP-15b's categories, wired once for `main.ts`, the route tests and the perf
 * tool. Created before the events module, whose resolver calls
 * `classifier.classifyEvent` after every resolution.
 */

export const RECLASSIFY_JOB_KEY = 'categories:reclassify';
/** A fallback: a rule edit triggers the job at once; this only catches a run left by a restart. */
export const RECLASSIFY_JOB_INTERVAL_MS = 10 * 60_000;

export interface CategoriesModule {
  readonly repo: CategoriesRepository;
  readonly classifier: CategoryClassifier;
  readonly admin: CategoryAdminService;
}

export interface CategoriesModuleDependencies {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly onRunRequested?: () => void;
}

export function createCategoriesModule(deps: CategoriesModuleDependencies): CategoriesModule {
  const repo = new CategoriesRepository(deps.db);
  const classifier = new CategoryClassifier({
    repo,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deps.onRunRequested === undefined ? {} : { onRunRequested: deps.onRunRequested }),
  });
  const admin = new CategoryAdminService({
    repo,
    classifier,
    audit: deps.audit,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
  return { repo, classifier, admin };
}

/** The batched re-classification, as a GENERAL job: resumable, abortable at shutdown. */
export function registerReclassifyJob(scheduler: Scheduler, classifier: CategoryClassifier): void {
  scheduler.register({
    key: RECLASSIFY_JOB_KEY,
    intervalMs: RECLASSIFY_JOB_INTERVAL_MS,
    run: async (context) => {
      const progress = await classifier.processPending({ signal: context.signal });
      return {
        outcome: progress.finished ? 'SUCCESS' : 'PARTIAL',
        detail: `${String(progress.events)} events, ${String(progress.changed)} changed`,
      };
    },
  });
}
