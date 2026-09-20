import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HealthResponse } from '@compintel/contracts';

import { devRoot, removeTempDir } from '../testing/temp.js';
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
/** Beside the data directory, never inside it: ruling R43 refuses the latter. */
const BACKUP_DIR = path.join(STAGE, 'backups');

/** What the first-run wizard sends (rulings R40-R44). */
const SETUP_REQUEST = {
  organization: { name: 'Smoke Institute of Technology', shortName: 'SIT' },
  department: { name: 'Computer Science', code: 'CSE' },
  campus: { name: 'Main Campus', lat: 12.9716, lon: 77.5946 },
  admin: {
    email: 'smoke@example.edu',
    displayName: 'Smoke Administrator',
    password: 'smoke-bundle-admin-pw-1',
  },
  scraperContactEmail: 'compintel@example.edu',
  backupDir: BACKUP_DIR,
  backupPassphrase: 'smoke bundle backup passphrase',
} as const;

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

/** Only the fields this smoke asserts on; everything else stays `unknown`. */
interface JsonBody {
  readonly code?: string;
  readonly ok?: boolean;
  readonly token?: string;
  readonly recoveryCode?: unknown;
  readonly recoveryFile?: unknown;
  readonly [key: string]: unknown;
}

interface JsonResponse {
  readonly status: number;
  readonly body: JsonBody;
}

/** A POST with the client header, parsed leniently: a 500 has a body too. */
async function post(baseUrl: string, route: string, body: unknown): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}/api/v1${route}`, {
    method: 'POST',
    headers: { 'X-CompIntel-Client': clientSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed as JsonBody };
}

async function runOnce(label: string): Promise<BackendProcess> {
  const backend = await spawnBackend({
    command: process.execPath,
    args: [BUNDLE, '--data-dir', DATA_DIR, '--stdin-lifeline'],
    env: { COMPINTEL_CLIENT_SECRET: clientSecret, PORT: '0' },
  });
  check(backend.ready.ready, `${label}: the bundle did not report ready:true`);
  return backend;
}

removeTempDir(STAGE);
mkdirSync(STAGE, { recursive: true });
mkdirSync(BACKUP_DIR, { recursive: true });

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

  // A brand-new data directory has no administrator, so ruling R39's gate is on:
  // every route but the exempt few answers 409 SETUP_REQUIRED. Until WP-07b this
  // was where the smoke logged in; the gate now comes first, so the login proof
  // moves below the wizard.
  const gated = await post(baseUrl, '/auth/login', {
    email: 'nobody@example.edu',
    password: 'not-the-password',
  });
  check(
    gated.status === 409 && gated.body.code === 'SETUP_REQUIRED',
    `/auth/login answered ${gated.status.toString()} ${String(gated.body.code)}, ` +
      'expected 409 SETUP_REQUIRED (the R39 gate is not on)',
  );
  steps.push('/auth/login 409 SETUP_REQUIRED: the R39 gate holds on a fresh data directory');

  // The wizard, driven the way the UI drives it. This is also what proves the
  // two native addons under `native\` loaded (R17): `setup/complete` hashes the
  // admin password and the recovery code with Argon2id, and the login below
  // verifies that hash. A bundle that could not load the addon answers 500 here.
  const checked = await post(baseUrl, '/setup/check-path', { path: BACKUP_DIR });
  check(
    checked.status === 200 && checked.body.ok === true,
    `/setup/check-path refused ${BACKUP_DIR}: ${JSON.stringify(checked.body)}`,
  );
  steps.push('/setup/check-path 200 ok=true: the write probe ran on a real folder');

  const completed = await post(baseUrl, '/setup/complete', SETUP_REQUEST);
  check(
    completed.status === 200 && typeof completed.body.recoveryCode === 'string',
    `/setup/complete answered ${completed.status.toString()}: ${JSON.stringify(completed.body)}`,
  );
  check(
    typeof completed.body.recoveryFile === 'string' &&
      completed.body.recoveryFile.includes('age1') &&
      !completed.body.recoveryFile.includes('AGE-SECRET-KEY-'),
    'the recovery file is missing the public key or carries a plaintext identity (R42)',
  );
  steps.push(
    '/setup/complete 200: age keys generated, recovery file carries no plaintext identity',
  );

  const login = await post(baseUrl, '/auth/login', {
    email: SETUP_REQUEST.admin.email,
    password: SETUP_REQUEST.admin.password,
  });
  check(
    login.status === 200 && typeof login.body.token === 'string',
    `/auth/login answered ${login.status.toString()} ${String(login.body.code)}, ` +
      'expected 200 (the Argon2id addon did not load)',
  );
  steps.push('/auth/login 200 for the new administrator: the Argon2id addon loaded from native\\');

  const done = await post(baseUrl, '/setup/complete', SETUP_REQUEST);
  check(
    done.status === 409 && done.body.code === 'SETUP_ALREADY_DONE',
    `a second /setup/complete answered ${done.status.toString()} ${String(done.body.code)}`,
  );
  steps.push('/setup/complete 409 SETUP_ALREADY_DONE the second time');

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
  // Best-effort, and deliberately not `rmSync`: Windows holds the SQLite and
  // addon handles for a moment after the child exits, and an EPERM here used to
  // replace the real failure with a cleanup error.
  removeTempDir(STAGE);
}
