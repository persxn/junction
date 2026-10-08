import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { SettingsStore } from '../../platform/settings.js';
import type { Clock } from '../../platform/time.js';
import { StudentImportService } from './import/service.js';
import { StudentLifecycleService } from './lifecycle.js';
import type { StudentsDependencies } from './mappers.js';
import { RelationsRepository } from './relations-repo.js';
import { StudentsRepository } from './repository.js';
import { StudentRelationsService } from './relations.js';
import { StudentsService } from './service.js';
import { StudentHistoryRepository } from './history-repo.js';
import { StudentHistoryService } from './history.js';
import { CompetitionLinksRepository } from '../engagements/links-repo.js';
import { TeamLinksRepository } from './team-links-repo.js';

/**
 * The students module (WP-17), wired once from `main.ts` and the test servers.
 * Four services over two repositories: records, relations (tags, mentorships,
 * achievements), lifecycle (status, erasure, settings) and the import.
 */

export interface StudentsModule {
  readonly records: StudentsService;
  readonly relations: StudentRelationsService;
  readonly lifecycle: StudentLifecycleService;
  readonly imports: StudentImportService;
  /** WP-21: competitions, teams and achievements, newest first. */
  readonly history: StudentHistoryService;
  readonly repository: StudentsRepository;
}

export interface StudentsModuleOptions {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly settings: SettingsStore;
  readonly clock?: Clock;
}

export function createStudentsModule(options: StudentsModuleOptions): StudentsModule {
  const repository = new StudentsRepository(options.db);
  const deps: StudentsDependencies = {
    students: repository,
    relations: new RelationsRepository(options.db),
    teamLinks: new TeamLinksRepository(options.db),
    competitionLinks: new CompetitionLinksRepository(options.db),
    audit: options.audit,
    settings: options.settings,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  return {
    records: new StudentsService(deps),
    relations: new StudentRelationsService(deps),
    lifecycle: new StudentLifecycleService(deps),
    imports: new StudentImportService(deps),
    history: new StudentHistoryService(new StudentHistoryRepository(options.db)),
    repository,
  };
}
