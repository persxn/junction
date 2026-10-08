import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { EngagementsRepository } from '../engagements/repository.js';
import { WorkflowCopier } from './copy.js';
import { StagesService } from './stages.js';
import { TasksService } from './tasks.js';
import { TemplatesService } from './templates.js';
import { TemplatesRepository } from './templates-repo.js';
import { WorkflowReader, type WorkflowsDependencies } from './workflow-reader.js';
import { WorkflowRepository } from './workflow-repo.js';

/**
 * The workflows module (WP-20a), wired once from `main.ts` and the test
 * servers: templates, the copy that runs as a competition enters ASSIGNED,
 * the workflow view, and its stage and task writes. The competitions module
 * takes `copier.onAssigned` and `reader.summaries` from here.
 */

export interface WorkflowsModule {
  readonly templates: TemplatesService;
  readonly templatesRepository: TemplatesRepository;
  readonly reader: WorkflowReader;
  readonly copier: WorkflowCopier;
  readonly stages: StagesService;
  readonly tasks: TasksService;
}

export interface WorkflowsModuleOptions {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export function createWorkflowsModule(options: WorkflowsModuleOptions): WorkflowsModule {
  const templatesRepository = new TemplatesRepository(options.db);
  const clock = options.clock === undefined ? {} : { clock: options.clock };
  const deps: WorkflowsDependencies = {
    workflows: new WorkflowRepository(options.db),
    templates: templatesRepository,
    engagements: new EngagementsRepository(options.db),
    audit: options.audit,
    ...clock,
  };
  return {
    templates: new TemplatesService({
      templates: templatesRepository,
      audit: options.audit,
      ...clock,
    }),
    templatesRepository,
    reader: new WorkflowReader(deps),
    copier: new WorkflowCopier(deps),
    stages: new StagesService(deps),
    tasks: new TasksService(deps),
  };
}
