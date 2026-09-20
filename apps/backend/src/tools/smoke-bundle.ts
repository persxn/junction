import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HealthResponse } from '@compintel/contracts';

import { devRoot } from '../testing/temp.js';
import { baseUrlOf, spawnBackend, type BackendProcess } from '../testing/backend-process.js';

const DIST = fileURLToPath(new URL('../../dist-bundle/', import.meta.url));

/**
 * Ruling R17: the bundle must run where no `node_modules` can be found, which is
 * the whole point of copying the addon next to it. Staging under
 * `%LOCALAPPDATA%\CompIntel-dev` also keeps dev data out of the repo (CLAUDE.md).
 */
const STAGE = path.join(devRoot(), 'bundle-smoke');
const BUNDLE = path.join(STAGE, 'main.mjs');
const DATA_DIR = path.join(STAGE, 'data-dir');

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`smoke:bundle - ${message}`);
  }
}

function assertNoNodeModulesAbove(dir: string): void {
  let current = dir;
  for (;;) {
    check(
      !existsSync(path.join(current, 'node_modules')),
      `found node_modules at "${current}"; the bundle would not be proving anything`,
    );
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function preMigrationCopies(): string[] {
  const dir = path.join(DATA_DIR, 'backups-local');
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.startsWith('pre-migration-'))
    : [];
}

const clientSecret = randomBytes(32).toString('hex');
const steps: string[] = [];

async function runOnce(label: string): Promise<BackendProcess> {
  const backend = await spawnBackend({
    command: process.execPath,
    args: [BUNDLE, '--data-dir', DATA_DIR, '--stdin-lifeline'],
    env: { COMPINTEL_CLIENT_SECRET: clientSecret, PORT: '0' },
  });
  check(backend.ready.ready, `${label}: the bundle did not report ready:true`);
  return backend;
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

try {
  cpSync(DIST, STAGE, { recursive: true });
  assertNoNodeModulesAbove(STAGE);
  steps.push(`staged the bundle in ${STAGE} with no node_modules above it`);

  // --- first run: a brand-new data directory -------------------------------
  const first = await runOnce('first run');
  const baseUrl = baseUrlOf(first);
  steps.push(`READY parsed: ${JSON.stringify(first.ready)}`);

  const response = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { 'X-CompIntel-Client': clientSecret },
  });
  check(response.status === 200, `/health answered ${response.status.toString()}, expected 200`);
  const health = HealthResponse.parse(await response.json());
  check(health.database.ok, '/health reported database.ok = false');
  check(
    health.database.migrationsApplied >= 1,
    `/health reported migrationsApplied = ${health.database.migrationsApplied.toString()}`,
  );
  steps.push(
    `/health 200: database.ok=true migrationsApplied=${health.database.migrationsApplied.toString()}`,
  );

  // Proves the Argon2id addon under `native\` loaded (R17). A login for an
  // account that does not exist still hashes, so a 401 with this code means the
  // addon ran; a bundle that could not load it would answer 500 instead.
  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'X-CompIntel-Client': clientSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.edu', password: 'not-the-password' }),
  });
  const loginBody = (await login.json()) as { code?: string };
  check(
    login.status === 401 && loginBody.code === 'AUTH_INVALID_CREDENTIALS',
    `/auth/login answered ${login.status.toString()} ${String(loginBody.code)}, ` +
      'expected 401 AUTH_INVALID_CREDENTIALS (the Argon2id addon did not load)',
  );
  steps.push('/auth/login 401 AUTH_INVALID_CREDENTIALS: the Argon2id addon loaded from native\\');

  check(
    preMigrationCopies().length === 0,
    'a new database should not produce a pre-migration copy',
  );
  steps.push('new database: no pre-migration copy');

  first.child.stdin.end();
  check(
    (await first.waitForExit(10_000)) === 0,
    'the first run did not exit 0 after stdin reached EOF',
  );
  steps.push('first run: stdin EOF -> exit 0');

  // --- second run: nothing left to apply -----------------------------------
  const second = await runOnce('second run');
  const secondHealth = HealthResponse.parse(
    await (
      await fetch(`${baseUrlOf(second)}/api/v1/health`, {
        headers: { 'X-CompIntel-Client': clientSecret },
      })
    ).json(),
  );
  check(
    secondHealth.database.migrationsApplied === health.database.migrationsApplied,
    'the second run changed the migration count',
  );
  check(preMigrationCopies().length === 0, 'the second run made a pre-migration copy');
  steps.push('second run: applied nothing, made no copy');

  second.child.stdin.end();
  check((await second.waitForExit(10_000)) === 0, 'the second run did not exit 0');
  check(
    second.trailingStdout().trim().length === 0,
    `the bundle wrote more than the READY line to stdout: ${second.trailingStdout()}`,
  );
  steps.push('second run: stdin EOF -> exit 0, stdout carried only the READY line');

  for (const step of steps) {
    process.stdout.write(`  ok  ${step}\n`);
  }
  process.stdout.write('smoke:bundle PASSED\n');
} finally {
  rmSync(STAGE, { recursive: true, force: true });
}
