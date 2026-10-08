import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { TeamsRepository } from '../teams/repository.js';
import { AssignService } from './assign.js';
import { CompetitionPeopleService } from './people.js';
import type {
  EngagementsDependencies,
  OnAssignedHook,
  OutcomeLookup,
  WorkflowSummaries,
} from './reader.js';
import { EngagementsRepository } from './repository.js';
import { EngagementsService } from './service.js';

/**
 * The competitions module (WP-19), wired once from `main.ts` and the test
 * servers. `onAssigned` is R98's seam: the hooks run inside the transaction
 * that enters ASSIGNED; WP-20a registers the workflow copy as the first.
 */

export interface EngagementsModule {
  readonly records: EngagementsService;
  readonly assign: AssignService;
  readonly people: CompetitionPeopleService;
  readonly repository: EngagementsRepository;
}

export interface EngagementsModuleOptions {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly onAssigned?: readonly OnAssignedHook[];
  /** WP-20a: the workflows module's progress and health, for the list. */
  readonly summaries?: WorkflowSummaries;
  /** WP-21: results and outcomes, from the outcomes module. */
  readonly outcomes?: OutcomeLookup;
  readonly clock?: Clock;
}

export function createEngagementsModule(options: EngagementsModuleOptions): EngagementsModule {
  const repository = new EngagementsRepository(options.db);
  const deps: EngagementsDependencies = {
    engagements: repository,
    teams: new TeamsRepository(options.db),
    audit: options.audit,
    onAssigned: options.onAssigned ?? [],
    ...(options.summaries === undefined ? {} : { summaries: options.summaries }),
    ...(options.outcomes === undefined ? {} : { outcomes: options.outcomes }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  return {
    records: new EngagementsService(deps),
    assign: new AssignService(deps),
    people: new CompetitionPeopleService(deps),
    repository,
  };
}
