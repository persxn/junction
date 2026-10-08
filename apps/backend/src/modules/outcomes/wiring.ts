import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import type { OutcomeLookup } from '../engagements/reader.js';
import type { EngagementsModule } from '../engagements/wiring.js';
import type { ResourcesModule } from '../resources/wiring.js';
import { OutcomesRepository } from './repository.js';
import { OutcomesService, toOutcomeView } from './service.js';

/**
 * The outcomes module (WP-21). The competitions module shows each one's result
 * and outcome, and recording one moves a competition to COMPLETED through the
 * competitions module — so the lookup is made first, from the table alone, and
 * the service after both exist.
 */

export interface OutcomesModule {
  readonly service: OutcomesService;
  readonly repository: OutcomesRepository;
}

export function createOutcomeLookup(
  db: DatabaseHandle,
  resources: ResourcesModule,
): { readonly repository: OutcomesRepository; readonly lookup: OutcomeLookup } {
  const repository = new OutcomesRepository(db);
  return {
    repository,
    lookup: {
      results: (ids) => repository.results(ids),
      view: (id) => {
        const row = repository.find(id);
        return row === undefined ? null : toOutcomeView(row, resources.repository);
      },
    },
  };
}

export function createOutcomesModule(options: {
  readonly repository: OutcomesRepository;
  readonly competitions: EngagementsModule;
  readonly resources: ResourcesModule;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}): OutcomesModule {
  return {
    repository: options.repository,
    service: new OutcomesService({
      outcomes: options.repository,
      competitions: options.competitions,
      resources: options.resources,
      audit: options.audit,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
  };
}
