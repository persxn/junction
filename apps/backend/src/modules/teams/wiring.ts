import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { RelationsRepository } from '../students/relations-repo.js';
import { TeamMembersService } from './members.js';
import { TeamMentorsService } from './mentors.js';
import type { TeamsDependencies } from './reader.js';
import { TeamsRepository } from './repository.js';
import { TeamsService } from './service.js';

/**
 * The teams module (WP-18), wired once from `main.ts` and the test servers:
 * records, members and mentors over one repository.
 */

export interface TeamsModule {
  readonly records: TeamsService;
  readonly members: TeamMembersService;
  readonly mentors: TeamMentorsService;
  readonly repository: TeamsRepository;
}

export interface TeamsModuleOptions {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export function createTeamsModule(options: TeamsModuleOptions): TeamsModule {
  const repository = new TeamsRepository(options.db);
  const deps: TeamsDependencies = {
    teams: repository,
    tags: new RelationsRepository(options.db),
    audit: options.audit,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  return {
    records: new TeamsService(deps),
    members: new TeamMembersService(deps),
    mentors: new TeamMentorsService(deps),
    repository,
  };
}
