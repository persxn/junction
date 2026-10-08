import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { DeadlinesRepository } from './repo.js';
import { DeadlinesService } from './service.js';

/** The deadlines module (WP-22): the Radar, and the read the KPI strip and the evaluator share. */

export interface DeadlinesModule {
  readonly service: DeadlinesService;
  readonly repository: DeadlinesRepository;
}

export function createDeadlinesModule(options: {
  readonly db: DatabaseHandle;
  readonly clock?: Clock;
}): DeadlinesModule {
  const repository = new DeadlinesRepository(options.db);
  return {
    repository,
    service: new DeadlinesService({
      repo: repository,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
  };
}
