import type { EventQueryInput, SavedSearch } from '@compintel/contracts';
import { EventQuery } from '@compintel/contracts';
import { pino } from 'pino';

import { JobStore } from '../jobs/store.js';
import { Scheduler } from '../jobs/scheduler.js';
import type { Principal } from '../modules/auth/types.js';
import {
  createNotificationsModule,
  type NotificationsModule,
} from '../modules/notifications/wiring.js';
import {
  createSavedSearchesModule,
  type SavedSearchesModule,
} from '../modules/saved-searches/wiring.js';
import { StreamHub } from '../platform/stream.js';
import { nowMs } from '../platform/time.js';
import { openSearchHarness, type SearchHarness } from './search.js';

/**
 * WP-24's bench: the search harness's database and injected clock, WP-23's
 * notifications on it, the saved-searches module, and a scheduler the test
 * ticks by hand. Synthetic events only (D-33); nothing is contacted.
 */

export interface SavedSearchBench {
  readonly h: SearchHarness;
  readonly hub: StreamHub;
  readonly scheduler: Scheduler;
  readonly notifications: NotificationsModule;
  readonly saved: SavedSearchesModule;
  readonly alice: Principal;
  create(name: string, query: EventQueryInput, notifyOnNew?: boolean): SavedSearch;
  /** One evaluator run at the bench's current time. */
  evaluate(): ReturnType<SavedSearchesModule['evaluate']>;
  /** NEW_MATCH rows for a user, oldest first. */
  newMatches(user?: Principal): { title: string; body: string; route: string | null }[];
  /** Announces a finished scrape run on the hub, as the orchestrator does (R86). */
  runFinished(outcome: string): void;
  close(): Promise<void>;
}

export function openSavedSearchBench(): SavedSearchBench {
  const h = openSearchHarness();
  const hub = new StreamHub({ clock: h.clock });
  const notifications = createNotificationsModule({ db: h.database.db, hub, clock: h.clock });
  const saved = createSavedSearchesModule({
    db: h.database.db,
    search: h.search.service,
    notifications: notifications.engine,
    clock: h.clock,
  });
  const scheduler = new Scheduler({
    store: new JobStore(h.database.db),
    logger: pino({ enabled: false }),
    clock: h.clock,
    random: () => 0.5,
  });
  const alice = h.user('PROFESSOR');
  let vocabularyFresh = false;
  const refresh = (): void => {
    if (!vocabularyFresh) h.search.vocabulary.refresh();
    vocabularyFresh = true;
  };
  return {
    h,
    hub,
    scheduler,
    notifications,
    saved,
    alice,
    create: (name, query, notifyOnNew = true) => {
      refresh();
      return saved.service.create(alice, { name, query: EventQuery.parse(query), notifyOnNew });
    },
    evaluate: () => {
      h.search.vocabulary.refresh();
      return saved.evaluate(nowMs(h.clock));
    },
    newMatches: (user = alice) =>
      h.database.db.raw
        .prepare(
          `SELECT title, body, route FROM notifications WHERE user_id = ? AND type = 'NEW_MATCH'
           ORDER BY created_at, id`,
        )
        .all(user.id) as { title: string; body: string; route: string | null }[],
    runFinished: (outcome) => {
      hub.publish('source.run.finished', {
        sourceKey: 'devfolio',
        outcome,
        finishedAt: nowMs(h.clock),
      });
    },
    close: async () => {
      await scheduler.stop('test');
      h.close();
    },
  };
}
