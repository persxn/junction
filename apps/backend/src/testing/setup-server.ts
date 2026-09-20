import { AuthRepository } from '../modules/auth/repository.js';
import { AuthService } from '../modules/auth/service.js';
import { SetupRepository } from '../modules/setup/repository.js';
import { SetupService } from '../modules/setup/service.js';
import { UsersRepository } from '../modules/users/repository.js';
import { UsersService } from '../modules/users/service.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { startTestServer, type TestServer } from './harness.js';
import { makeTempDir, removeTempDir } from './temp.js';

/**
 * A real server on a **completely empty** database — no organization, no admin —
 * which is the only state the setup module is ever exercised in.
 *
 * It wires the real `SetupService`, `UsersService` and `AuthService` against one
 * database, exactly as `main.ts` does, because the R39 gate is a property of how
 * those three are hooked together and a stub would prove nothing.
 */

export interface SetupTestServer {
  readonly server: TestServer;
  readonly database: MigratedDatabase;
  readonly setup: SetupService;
  readonly users: UsersService;
  readonly auth: AuthService;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  /** A folder outside the data directory that a backup destination may use. */
  readonly backupDir: string;
  /** The process data directory the R43 check compares against. */
  readonly dataDir: string;
  close(): Promise<void>;
}

export interface SetupTestServerOptions {
  /** Lowered in the low-space test; defaults to the real 1 GB floor. */
  readonly minFreeBytes?: number;
  /** Injected so a test can make the repository's write throw (R40). */
  readonly repository?: SetupRepository;
}

export async function startSetupTestServer(
  options: SetupTestServerOptions = {},
): Promise<SetupTestServer> {
  const database = openMigratedDatabase(undefined, 'setup');
  const dataDir = database.config.dataDir;
  // A sibling of the data directory, never inside it: R43 refuses that on purpose.
  const backupDir = makeTempDir('setup-backups');

  const settings = new SettingsStore(database.db);
  const audit = new AuditLog(database.db);
  const authRepository = new AuthRepository(database.db);
  const auth = new AuthService({ repository: authRepository, settings, audit });

  const setup = new SetupService({
    repository: options.repository ?? new SetupRepository(database.db),
    settings,
    audit,
    dataDir,
    appVersion: '0.1.0-test',
    ...(options.minFreeBytes === undefined ? {} : { minFreeBytes: options.minFreeBytes }),
  });
  const users = new UsersService({
    repository: new UsersRepository(database.db),
    auth: authRepository,
    audit,
    onAdministratorsChanged: () => {
      setup.invalidate();
    },
  });

  const server = await startTestServer({
    auth: () => auth,
    setup: () => setup,
    users: () => users,
  });

  return {
    server,
    database,
    setup,
    users,
    auth,
    settings,
    audit,
    backupDir,
    dataDir,
    close: async () => {
      await server.close();
      database.close();
      removeTempDir(backupDir);
    },
  };
}
