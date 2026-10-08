import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { EngagementsRepository } from '../engagements/repository.js';
import { ResourcesRepository } from './repository.js';
import { ResourcesService } from './service.js';

/** The resources module (WP-20b), wired once from `main.ts` and the test servers. */

export interface ResourcesModule {
  readonly service: ResourcesService;
  readonly repository: ResourcesRepository;
}

export function createResourcesModule(options: {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}): ResourcesModule {
  const repository = new ResourcesRepository(options.db);
  return {
    repository,
    service: new ResourcesService({
      resources: repository,
      engagements: new EngagementsRepository(options.db),
      audit: options.audit,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
  };
}
