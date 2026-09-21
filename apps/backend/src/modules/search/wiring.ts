import type { Logger } from 'pino';

import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { SettingsStore } from '../../platform/settings.js';
import type { Clock } from '../../platform/time.js';
import type { EventsRepository } from '../events/repository.js';
import { NEARBY_RADIUS_KM } from '../geo/settings.js';
import { AliasService } from './aliases.js';
import type { CursorCodec } from './cursor.js';
import { FacetRepository } from './facets.js';
import { SearchRepository } from './repo.js';
import { SearchService } from './service.js';
import { RANKING_THRESHOLDS, RANKING_WEIGHTS } from './settings.js';
import { VocabularyService } from './vocabulary.js';

/**
 * WP-15a's and WP-15b's pieces, wired once, for `main.ts`, the route tests and the perf
 * tool alike — so all three run the same code over the same SQL.
 */

export interface SearchModule {
  readonly repo: SearchRepository;
  readonly aliases: AliasService;
  readonly vocabulary: VocabularyService;
  readonly service: SearchService;
}

export interface SearchModuleDependencies {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly events: EventsRepository;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly cursors?: CursorCodec;
  /** The ranking settings are read from here per query (a fresh store over `db` when absent). */
  readonly settings?: SettingsStore;
}

export function createSearchModule(deps: SearchModuleDependencies): SearchModule {
  const repo = new SearchRepository(deps.db);
  // The alias service refreshes the vocabulary after a write, and the
  // vocabulary reads the aliases; one late-bound hop breaks the cycle.
  const holder: { vocabulary?: VocabularyService } = {};
  const aliases = new AliasService({
    db: deps.db,
    audit: deps.audit,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    onChange: () => holder.vocabulary?.refresh(),
  });
  const vocabulary = new VocabularyService({
    db: deps.db,
    repo,
    sources: { aliases: () => aliases.list() },
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  });
  holder.vocabulary = vocabulary;
  const settings = deps.settings ?? new SettingsStore(deps.db);
  const service = new SearchService({
    repo,
    facets: new FacetRepository(deps.db),
    ranking: () => ({
      weights: settings.get(RANKING_WEIGHTS),
      thresholds: settings.get(RANKING_THRESHOLDS),
      preferredRadiusKm: settings.get(NEARBY_RADIUS_KM),
    }),
    events: deps.events,
    aliases,
    vocabulary,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deps.cursors === undefined ? {} : { cursors: deps.cursors }),
  });
  return { repo, aliases, vocabulary, service };
}
