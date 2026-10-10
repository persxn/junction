import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { unwrapIdentity } from '../modules/backup/keys.js';
import { normalizeRecoveryCode } from '../modules/setup/recovery-code.js';
import { verifyPassword } from '../modules/auth/password.js';
import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';
import {
  AUTO_LOCK_MINUTES,
  BACKUP_DAILY_TIME_LOCAL,
  BACKUP_DESTINATION_DIR,
  BACKUP_PRIVATE_KEY_ENCRYPTED,
  BACKUP_PUBLIC_KEY,
  RECOVERY_CODE_HASH,
  SCRAPER_CONTACT_EMAIL,
} from '../settings.js';

/**
 * The first-run wizard over a real socket (rulings R39–R44).
 *
 * The state under test is the one that only exists once per installation — an
 * empty database — so every case starts a fresh server on a fresh data
 * directory rather than undoing the previous one.
 */

const PASSWORD = 'an-admin-password';
const PASSPHRASE = 'a-different-backup-passphrase';

let harness: SetupTestServer | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function request(backupDir: string): Record<string, unknown> {
  return {
    organization: { name: 'Example Institute of Technology', shortName: 'EIT' },
    department: { name: 'Computer Science and Engineering', code: 'CSE' },
    campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
    admin: { email: 'admin@example.edu', displayName: 'A. Administrator', password: PASSWORD },
    scraperContactEmail: 'compintel@example.edu',
    backupDir,
    backupPassphrase: PASSPHRASE,
  };
}

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  h: SetupTestServer,
  method: string,
  route: string,
  body?: unknown,
  token?: string,
): Promise<Answer> {
  const response = await fetch(`${h.server.baseUrl}${route}`, {
    method,
    headers: {
      'X-CompIntel-Client': h.server.config.clientSecret,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as never) };
}

/** A server whose scrypt is cheap, because these tests run it a lot. */
async function fresh(options: { minFreeBytes?: number } = {}): Promise<SetupTestServer> {
  harness = await startSetupTestServer(options);
  return harness;
}

describe('the setup gate (ruling R39)', () => {
  it('refuses everything else with 409 SETUP_REQUIRED', async () => {
    const h = await fresh();

    for (const [method, route] of [
      ['GET', '/api/v1/me'],
      ['GET', '/api/v1/admin/users'],
      ['GET', '/api/v1/stream'],
      ['POST', '/api/v1/auth/login'],
    ] as const) {
      // A well-formed login, so the gate is what refuses it rather than the
      // schema: on a fresh install there is simply nobody to sign in as.
      const body =
        route === '/api/v1/auth/login'
          ? { email: 'someone@example.edu', password: 'whatever-they-typed' }
          : undefined;
      const answer = await call(h, method, route, body);
      expect(answer.status, `${method} ${route}`).toBe(409);
      expect(answer.body.code, `${method} ${route}`).toBe('SETUP_REQUIRED');
    }
  });

  it('lets /health and the wizard through', async () => {
    const h = await fresh();

    expect((await call(h, 'GET', '/api/v1/health')).status).toBe(200);
    const status = await call(h, 'GET', '/api/v1/setup/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      required: true,
      hasAdmin: false,
      hasOrganization: false,
      hasBackupKey: false,
    });
  });

  it('opens once setup is done, and closes the wizard behind it', async () => {
    const h = await fresh();
    expect((await call(h, 'POST', '/api/v1/setup/complete', request(h.backupDir))).status).toBe(
      200,
    );

    // The gate is off: this is now an ordinary 401, not a 409.
    expect((await call(h, 'GET', '/api/v1/me')).status).toBe(401);

    const status = await call(h, 'GET', '/api/v1/setup/status');
    expect(status.body).toMatchObject({ required: false, hasAdmin: true, hasBackupKey: true });

    const again = await call(h, 'POST', '/api/v1/setup/complete', request(h.backupDir));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SETUP_ALREADY_DONE');
  });
});

describe('POST /setup/complete (ruling R40)', () => {
  it('writes exactly the expected rows and lets the admin sign straight in', async () => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/complete', request(h.backupDir));
    expect(answer.status).toBe(200);

    const raw = h.database.db.raw;
    const one = (sql: string): Record<string, unknown> =>
      raw.prepare(sql).get() as Record<string, unknown>;

    expect(one('select count(*) as n from organizations').n).toBe(1);
    expect(one('select name, short_name from organizations')).toMatchObject({
      name: 'Example Institute of Technology',
      short_name: 'EIT',
    });
    expect(one('select name, code, is_managing from departments')).toMatchObject({
      code: 'CSE',
      is_managing: 1,
    });
    expect(one('select name, lat, lon, is_primary from campuses')).toMatchObject({
      name: 'Main Campus',
      is_primary: 1,
    });
    expect(one('select email, must_change_password, status from users')).toMatchObject({
      email: 'admin@example.edu',
      // They chose it themselves; there is nothing to force (R38).
      must_change_password: 0,
      status: 'ACTIVE',
    });
    // Both roles, so the first account can also mentor a team.
    expect(one('select count(*) as n from user_roles').n).toBe(2);

    // The admin can log in immediately, with the password they just typed.
    const login = await call(h, 'POST', '/api/v1/auth/login', {
      email: 'admin@example.edu',
      password: PASSWORD,
      clientKind: 'DESKTOP',
    });
    expect(login.status).toBe(200);
    expect((login.body.user as Record<string, unknown>).mustChangePassword).toBe(false);
    expect(login.body.roles).toStrictEqual(['ADMINISTRATOR', 'PROFESSOR']);
  }, 30_000);

  it('stores every setting the wizard is responsible for', async () => {
    const h = await fresh();
    await call(h, 'POST', '/api/v1/setup/complete', request(h.backupDir));

    expect(h.settings.get(SCRAPER_CONTACT_EMAIL)).toBe('compintel@example.edu');
    expect(h.settings.get(BACKUP_DESTINATION_DIR)).toBe(path.resolve(h.backupDir));
    expect(h.settings.get(BACKUP_DAILY_TIME_LOCAL)).toBe('13:00');
    expect(h.settings.get(AUTO_LOCK_MINUTES)).toBe(15);
    expect(h.settings.get(BACKUP_PUBLIC_KEY)).toMatch(/^age1/);
    expect(h.settings.get(BACKUP_PRIVATE_KEY_ENCRYPTED)).toContain('BEGIN AGE ENCRYPTED FILE');
    expect(h.settings.get(RECOVERY_CODE_HASH)).toMatch(/^\$argon2id\$/);
  }, 30_000);

  it('hands back recovery material that actually works (R41, R42)', async () => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/complete', request(h.backupDir));

    const result = answer.body as {
      recoveryCode: string;
      recoveryFileName: string;
      recoveryFile: string;
    };
    expect(result.recoveryFileName).toMatch(/^junction-recovery-\d{8}\.txt$/);

    // The code is stored only as a hash, and that hash verifies (R41).
    const hash = h.settings.get(RECOVERY_CODE_HASH);
    expect(hash).not.toContain(result.recoveryCode);
    expect(await verifyPassword(hash, normalizeRecoveryCode(result.recoveryCode))).toBe(true);
    expect(await verifyPassword(hash, normalizeRecoveryCode('AAAAA-BBBBB'))).toBe(false);

    // The file carries the public key and the wrapped identity, and the
    // passphrase still opens it (R42).
    expect(result.recoveryFile).toContain(h.settings.get(BACKUP_PUBLIC_KEY));
    expect(result.recoveryFile).not.toContain('AGE-SECRET-KEY-1');
    expect(result.recoveryFile).not.toContain(result.recoveryCode);
    const identity = await unwrapIdentity(h.settings.get(BACKUP_PRIVATE_KEY_ENCRYPTED), PASSPHRASE);
    expect(identity).toMatch(/^AGE-SECRET-KEY-1/);
  }, 60_000);

  it('writes one setup.completed audit row and no secrets', async () => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/complete', request(h.backupDir));
    const result = answer.body as { recoveryCode: string };

    const rows = h.database.db.raw
      .prepare('select action, summary, diff_json from audit_log')
      .all() as { action: string; summary: string; diff_json: string | null }[];
    expect(rows.map((row) => row.action)).toStrictEqual(['setup.completed']);
    expect(rows[0]?.summary).toContain('Example Institute of Technology');

    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain(PASSPHRASE);
    expect(blob).not.toContain(result.recoveryCode);
    expect(h.audit.verifyChain().ok).toBe(true);
  }, 30_000);
});

describe('the passphrase rules (ruling R42)', () => {
  it('refuses one shorter than twelve characters', async () => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/complete', {
      ...request(h.backupDir),
      backupPassphrase: 'too-short',
    });
    // Caught by the schema before the service sees it.
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses one equal to the admin password', async () => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/complete', {
      ...request(h.backupDir),
      backupPassphrase: PASSWORD,
    });
    expect(answer.status).toBe(422);
    expect(answer.body.code).toBe('SETUP_PASSPHRASE_WEAK');
    expect(String(answer.body.detail)).toContain('different from your Junction password');
  });
});

describe('POST /setup/check-path (ruling R43)', () => {
  it('accepts a real folder and reports the free space', async () => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/check-path', { path: h.backupDir });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, resolvedPath: path.resolve(h.backupDir) });
    expect(answer.body.freeBytes).toBeGreaterThan(0);
  });

  it.each([
    ['MISSING', (h: SetupTestServer): string => path.join(h.backupDir, 'nope')],
    ['INSIDE_DATA_DIR', (h: SetupTestServer): string => h.dataDir],
  ])('refuses with %s', async (reason, pick) => {
    const h = await fresh();
    const answer = await call(h, 'POST', '/api/v1/setup/check-path', { path: pick(h) });
    expect(answer.body).toMatchObject({ ok: false, reason });
  });

  it('refuses a drive without room', async () => {
    const h = await fresh({ minFreeBytes: Number.MAX_SAFE_INTEGER });
    const answer = await call(h, 'POST', '/api/v1/setup/check-path', { path: h.backupDir });
    expect(answer.body).toMatchObject({ ok: false, reason: 'LOW_SPACE' });
  });

  it('refuses the completion too, not just the check', async () => {
    const h = await fresh();
    const missing = path.join(h.backupDir, 'not-created');
    const answer = await call(h, 'POST', '/api/v1/setup/complete', {
      ...request(h.backupDir),
      backupDir: missing,
    });
    expect(answer.status).toBe(422);
    expect(answer.body.code).toBe('SETUP_PATH_UNUSABLE');
  });

  it('accepts a folder created between the check and the completion', async () => {
    const h = await fresh();
    const later = path.join(h.backupDir, 'made-later');
    expect((await call(h, 'POST', '/api/v1/setup/check-path', { path: later })).body).toMatchObject(
      {
        ok: false,
        reason: 'MISSING',
      },
    );
    mkdirSync(later, { recursive: true });
    expect((await call(h, 'POST', '/api/v1/setup/check-path', { path: later })).body).toMatchObject(
      {
        ok: true,
      },
    );
  });
});
