import type { DatabaseHandle } from '../../platform/db.js';
import type { StreamHub } from '../../platform/stream.js';
import type { Clock } from '../../platform/time.js';
import { registerDueItemSink } from '../deadlines/evaluator.js';
import { NotificationEngine } from './engine.js';
import { NotificationsRepository } from './repo.js';

/**
 * The notifications module (WP-23): the engine (and its `emit`, for WP-24 and
 * WP-28) and the repository. `attachToEvaluator` makes the engine a sink of
 * WP-22's `deadline-evaluator`, so one offline-safe run does everything.
 */

export interface NotificationsModule {
  readonly engine: NotificationEngine;
  readonly repository: NotificationsRepository;
  attachToEvaluator(): () => void;
}

export function createNotificationsModule(options: {
  readonly db: DatabaseHandle;
  readonly hub: StreamHub;
  readonly clock?: Clock;
}): NotificationsModule {
  const repository = new NotificationsRepository(options.db);
  const engine = new NotificationEngine({
    repo: repository,
    hub: options.hub,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return {
    engine,
    repository,
    attachToEvaluator: () =>
      registerDueItemSink({
        name: 'notifications',
        consume: (items, { now }) => {
          engine.run(items, now);
        },
      }),
  };
}
