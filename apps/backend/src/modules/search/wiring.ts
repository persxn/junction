import type { Logger } from 'pino';

import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import type { EventsRepository } from '../events/repository.js';
import { AliasService } from './aliases.js';
import type { CursorCodec } from './cursor.js';
import { SearchRepository } from './repo.js';
import { SearchService } from './service.js';
import { VocabularyService } from './vocabulary.js';

/**
 * WP-15a's pieces, wired once, for `main.ts`, the route tests and the perf
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
  const service = new SearchService({
    repo,
    events: deps.events,
    aliases,
    vocabulary,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deps.cursors === undefined ? {} : { cursors: deps.cursors }),
  });
  return { repo, aliases, vocabulary, service };
}
