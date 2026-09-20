import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import type { RoleKey } from '@compintel/contracts';
import pino from 'pino';

import { hashPassword } from '../modules/auth/password.js';
import { AuthRepository } from '../modules/auth/repository.js';
import { ensureDataDirs, loadConfig } from '../platform/config.js';
import { openDatabase } from '../platform/db.js';
import { acquireDataDirLock } from '../platform/lock.js';
import { runMigrations } from '../platform/migrate.js';

/**
 * Creates the two accounts a manual run needs, until WP-07b's setup wizard makes
 * them properly.
 *
 * There is no route that creates a user — user administration is WP-07b — so
 * there is no way to sign in to a fresh data directory either. This is the
 * stopgap: `pnpm --filter @compintel/backend seed:dev`, one ADMINISTRATOR and one
 * PROFESSOR, each with `must_change_password` set so the first sign-in walks
 * through ruling R38 exactly as a real one will.
 *
 * It is a `tools/` entry, so it is not in the bundle, and **WP-07b deletes it**:
 * the wizard owns the first account, the password policy and the invitations.
 *
 * It takes the data-dir lock (R15) rather than writing behind a running backend,
 * so CompIntel has to be closed first — which is also when it is safe to do.
 */

const ACCOUNTS: readonly {
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly RoleKey[];
}[] = [
  { email: 'admin@compintel.local', displayName: 'Dev Administrator', roles: ['ADMINISTRATOR'] },
  { email: 'professor@compintel.local', displayName: 'Dev Professor', roles: ['PROFESSOR'] },
];

/** Readable, long enough for `PASSWORD_MIN_LENGTH`, and different every run. */
function generatedPassword(): string {
  return `dev-${randomBytes(9).toString('base64url')}`;
}

function parseFlags(): { password: string | undefined } {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { password: { type: 'string' } },
    allowPositionals: false,
    strict: false,
  });
  return { password: typeof values.password === 'string' ? values.password : undefined };
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const config = loadConfig();
  ensureDataDirs(config);

  const logger = pino({ level: 'warn' }, pino.destination(2));
  const lock = acquireDataDirLock(config, logger);
  const db = openDatabase(config, { logger });
  try {
    runMigrations(config, db, {
      migrationsDir: fileURLToPath(new URL('../../migrations', import.meta.url)),
      logger,
    });

    const repository = new AuthRepository(db);
    process.stdout.write(`seed:dev - data dir ${config.dataDir}\n`);

    for (const account of ACCOUNTS) {
      if (repository.findUserByEmail(account.email) !== undefined) {
        process.stdout.write(`  ${account.email.padEnd(26)} already exists, left alone\n`);
        continue;
      }
      const password = flags.password ?? generatedPassword();
      repository.createUser({
        email: account.email,
        displayName: account.displayName,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        roles: account.roles,
      });
      process.stdout.write(
        `  ${account.email.padEnd(26)} ${account.roles.join('+').padEnd(14)} password: ${password}\n`,
      );
    }

    process.stdout.write(
      'Both accounts must change their password at the first sign-in (ruling R38).\n',
    );
  } finally {
    db.close();
    lock.release();
  }
}

await main();
