import type { Logger } from 'pino';

import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { SettingsStore } from '../../platform/settings.js';
import type { Clock } from '../../platform/time.js';
import type { CategoriesRepository } from '../categories/repo.js';
import type { Geocoder } from '../geo/geocoder.js';
import { EVENT_TYPE_POLICY, GEOGRAPHY_POLICY } from '../geo/settings.js';
import { EventCategoriesService } from './categories.js';
import { DedupCandidatesRepository } from './dedup-repository.js';
import { EventDetailRepository } from './detail-repo.js';
import { EventDetailService } from './detail.js';
import { EventLinker } from './link.js';
import { MergeService } from './merge.js';
import { ProvenanceRepository } from './provenance.js';
import { EventsRepository } from './repository.js';
import { EventResolver } from './resolver.js';
import { DedupReviewService } from './review.js';
import { SeriesRepository } from './series.js';
import { readDedupConfig } from './settings.js';

/**
 * WP-10's pieces, wired once. `main.ts` and the test harnesses call this, so
 * the scrape linker, the merge service and the review API always share one
 * resolver and read the same R65 settings.
 */

export interface EventsModule {
  readonly linker: EventLinker;
  /** WP-16b: the detail drawer's one round trip, and the category override. */
  readonly detail: EventDetailService;
  readonly detailRepo: EventDetailRepository;
  readonly merges: MergeService;
  readonly review: DedupReviewService;
  readonly resolver: EventResolver;
  readonly provenance: ProvenanceRepository;
  readonly candidates: DedupCandidatesRepository;
  readonly events: EventsRepository;
  readonly series: SeriesRepository;
  /** Present only when a `CategoriesRepository` was supplied. */
  readonly categoryOverrides: EventCategoriesService | undefined;
}

export interface EventsModuleDependencies {
  readonly db: DatabaseHandle;
  /** WP-16b: needed only by the category override; without it there is none. */
  readonly categories?: CategoriesRepository;
  readonly geocoder: Pick<Geocoder, 'resolve'>;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly logger: Logger;
  readonly clock?: Clock;
  /** WP-15b: the category classifier, run after every resolution (see `EventResolver`). */
  readonly onResolved?: (eventId: string, at: number) => void;
}

export function createEventsModule(deps: EventsModuleDependencies): EventsModule {
  const events = new EventsRepository(deps.db);
  const provenance = new ProvenanceRepository(deps.db);
  const candidates = new DedupCandidatesRepository(deps.db);
  const resolver = new EventResolver({
    events,
    provenance,
    policies: () => ({
      eventType: deps.settings.get(EVENT_TYPE_POLICY),
      geography: deps.settings.get(GEOGRAPHY_POLICY),
    }),
    ...(deps.onResolved === undefined ? {} : { onResolved: deps.onResolved }),
  });
  const series = new SeriesRepository(deps.db, deps.audit);
  const linker = new EventLinker({
    series,
    events,
    provenance,
    candidates,
    resolver,
    geocoder: deps.geocoder,
    audit: deps.audit,
    dedupConfig: () =>
      readDedupConfig(deps.settings, (reason) => {
        deps.logger.warn({ reason }, 'the dedup settings disagree with each other; using defaults');
      }),
  });
  const merges = new MergeService({
    events,
    provenance,
    candidates,
    resolver,
    audit: deps.audit,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
  const review = new DedupReviewService({ events, provenance, candidates, resolver, merges });
  const detailRepo = new EventDetailRepository(deps.db);
  const detail = new EventDetailService({ events, provenance, resolver, detail: detailRepo });
  const categoryOverrides =
    deps.categories === undefined
      ? undefined
      : new EventCategoriesService({
          events,
          categories: deps.categories,
          detail: detailRepo,
          audit: deps.audit,
          ...(deps.clock === undefined ? {} : { clock: deps.clock }),
        });
  return {
    linker,
    merges,
    review,
    resolver,
    provenance,
    candidates,
    events,
    series,
    detail,
    detailRepo,
    categoryOverrides,
  };
}
