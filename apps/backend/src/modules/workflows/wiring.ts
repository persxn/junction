import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { TemplatesService } from './templates.js';
import { TemplatesRepository } from './templates-repo.js';

/**
 * The workflows module (WP-20a), wired once from `main.ts` and the test
 * servers: templates now; the workflow itself and copy-on-assign join it in
 * step 5.
 */

export interface WorkflowsModule {
  readonly templates: TemplatesService;
  readonly templatesRepository: TemplatesRepository;
}

export interface WorkflowsModuleOptions {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export function createWorkflowsModule(options: WorkflowsModuleOptions): WorkflowsModule {
  const templatesRepository = new TemplatesRepository(options.db);
  return {
    templates: new TemplatesService({
      templates: templatesRepository,
      audit: options.audit,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
    templatesRepository,
  };
}
