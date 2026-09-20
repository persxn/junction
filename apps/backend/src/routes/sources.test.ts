import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * `/sources`, `/sources/status` and `/admin/sources/*` over a real socket
 * (§10.2 `source.manage`, §7.2).
 *
 * One installation for the whole file, set up once. Argon2id is deliberately
 * expensive (§4.12), so a per-test wizard run would cost half a minute in
 * password hashing to prove things that have nothing to do with passwords. The
 * cases below are written to be order-independent: each reads the version it is
 * about to send rather than assuming one.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PROFESSOR_PASSWORD = 'a-professor-chosen-password';
const PASSPHRASE = 'a-different-backup-passphrase';

let harness: SetupTestServer;
let adminToken: string;
/** An account with no `source.manage`, to prove the matrix is enforced. */
let professor: string;

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  method: string,
  route: string,
  options: { body?: unknown; token?: string } = {},
): Promise<Answer> {
  const response = await fetch(`${harness.server.baseUrl}${route}`, {
    method,
    headers: {
      'X-CompIntel-Client': harness.server.config.clientSecret,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as never) };
}

async function signIn(email: string, password: string): Promise<string> {
  const answer = await call('POST', '/api/v1/auth/login', {
    body: { email, password, clientKind: 'DESKTOP' },
  });
  if (answer.status !== 200) {
    throw new Error(`login for ${email} failed: ${JSON.stringify(answer.body)}`);
  }
  return answer.body.token as string;
}

/** The current row for a key, straight from the API. */
async function source(key: string): Promise<{ version: number; [field: string]: unknown }> {
  const answer = await call('GET', '/api/v1/sources', { token: adminToken });
  const found = (answer.body.sources as { key: string; version: number }[]).find(
    (entry) => entry.key === key,
  );
  if (found === undefined) {
    throw new Error(`no source ${key}`);
  }
  return found;
}

beforeAll(async () => {
  harness = await startSetupTestServer();
  const complete = await call('POST', '/api/v1/setup/complete', {
    body: {
      organization: { name: 'Example Institute of Technology' },
      department: { name: 'Computer Science and Engineering', code: 'CSE' },
      campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
      admin: {
        email: 'admin@example.edu',
        displayName: 'A. Administrator',
        password: ADMIN_PASSWORD,
      },
      scraperContactEmail: 'compintel@example.edu',
      backupDir: harness.backupDir,
      backupPassphrase: PASSPHRASE,
    },
  });
  if (complete.status !== 200) {
    throw new Error(`setup failed: ${JSON.stringify(complete.body)}`);
  }
  adminToken = await signIn('admin@example.edu', ADMIN_PASSWORD);

  const created = await call('POST', '/api/v1/admin/users', {
    token: adminToken,
    body: { email: 'professor@example.edu', displayName: 'A. Professor', roles: ['PROFESSOR'] },
  });
  const temporary = created.body.temporaryPassword as string;
  const firstToken = await signIn('professor@example.edu', temporary);
  await call('POST', '/api/v1/auth/change-password', {
    token: firstToken,
    body: { currentPassword: temporary, newPassword: PROFESSOR_PASSWORD },
  });
  professor = await signIn('professor@example.edu', PROFESSOR_PASSWORD);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('GET /sources', () => {
  it('lists the five seeded sources with their verdicts', async () => {
    const answer = await call('GET', '/api/v1/sources', { token: adminToken });
    expect(answer.status).toBe(200);
    const list = answer.body.sources as { key: string; complianceStatus: string }[];
    expect(list.map((entry) => entry.key).sort()).toEqual([
      'clist',
      'ctftime',
      'devfolio',
      'devpost',
      'unstop',
    ]);
    expect(list.find((entry) => entry.key === 'devpost')?.complianceStatus).toBe(
      'MANUAL_IMPORT_ONLY',
    );
  });

  it('never exposes config_json, which is where an API key would live', async () => {
    const answer = await call('GET', '/api/v1/sources', { token: adminToken });
    expect(JSON.stringify(answer.body)).not.toContain('apiKeySetting');
    expect(JSON.stringify(answer.body)).not.toContain('configJson');
  });

  it('needs a session', async () => {
    expect((await call('GET', '/api/v1/sources')).status).toBe(401);
  });

  it('is readable by a professor: "where did this event come from?" is not admin-only', async () => {
    expect((await call('GET', '/api/v1/sources', { token: professor })).status).toBe(200);
  });
});

describe('GET /sources/status', () => {
  it('reports freshness, the next attempt and a §7.7 sentence for each source', async () => {
    const answer = await call('GET', '/api/v1/sources/status', { token: adminToken });
    expect(answer.status).toBe(200);
    const list = answer.body.sources as {
      source: { key: string };
      lastSuccessAt: string | null;
      freshnessMinutes: number | null;
      consecutiveFailures: number;
      message: string;
    }[];
    expect(list).toHaveLength(5);
    const devpost = list.find((entry) => entry.source.key === 'devpost');
    expect(devpost?.lastSuccessAt).toBeNull();
    expect(devpost?.freshnessMinutes).toBeNull();
    expect(devpost?.consecutiveFailures).toBe(0);
    expect(devpost?.message).toContain('disabled by policy');
  });
});

describe('PATCH /admin/sources/:key', () => {
  it('lets an administrator change the cadence and bumps the version', async () => {
    const before = await source('ctftime');
    const answer = await call('PATCH', '/api/v1/admin/sources/ctftime', {
      token: adminToken,
      body: { cadenceMinutes: 60, version: before.version },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.source).toMatchObject({
      cadenceMinutes: 60,
      version: before.version + 1,
    });
  });

  it('refuses a stale version with a 409 (§6.1)', async () => {
    const before = await source('clist');
    await call('PATCH', '/api/v1/admin/sources/clist', {
      token: adminToken,
      body: { minDelayMs: 7_000, version: before.version },
    });
    const again = await call('PATCH', '/api/v1/admin/sources/clist', {
      token: adminToken,
      body: { minDelayMs: 8_000, version: before.version },
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
  });

  it('refuses a professor with a 403 (§10.2)', async () => {
    const before = await source('devfolio');
    const answer = await call('PATCH', '/api/v1/admin/sources/devfolio', {
      token: professor,
      body: { isEnabled: true, version: before.version },
    });
    expect(answer.status).toBe(403);
    expect((await source('devfolio')).isEnabled).toBe(false);
  });

  it('rejects an attempt to set compliance_status, before a handler sees it', async () => {
    const before = await source('devpost');
    const answer = await call('PATCH', '/api/v1/admin/sources/devpost', {
      token: adminToken,
      body: { complianceStatus: 'APPROVED', version: before.version },
    });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    expect((await source('devpost')).complianceStatus).toBe('MANUAL_IMPORT_ONLY');
  });

  it('answers 404 for a key that does not exist', async () => {
    const answer = await call('PATCH', '/api/v1/admin/sources/nosuch', {
      token: adminToken,
      body: { isEnabled: true, version: 1 },
    });
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('SOURCE_NOT_FOUND');
  });

  it('audits the change and leaves the hash chain intact', async () => {
    const before = await source('unstop');
    await call('PATCH', '/api/v1/admin/sources/unstop', {
      token: adminToken,
      body: { maxRequestsPerRun: 10, version: before.version },
    });
    expect(harness.audit.all().map((row) => row.action)).toContain('source.updated');
    expect(harness.audit.verifyChain().ok).toBe(true);
  });
});

describe('POST /admin/sources/:key/refresh', () => {
  it('refuses a professor', async () => {
    const answer = await call('POST', '/api/v1/admin/sources/ctftime/refresh', {
      token: professor,
    });
    expect(answer.status).toBe(403);
  });

  it('answers 409 while no adapter is registered (WP-09a ships none)', async () => {
    const answer = await call('POST', '/api/v1/admin/sources/ctftime/refresh', {
      token: adminToken,
    });
    expect(answer.status).toBe(409);
    expect(String(answer.body.detail)).toContain('No adapter is registered');
    // It still audited the request: somebody asked, and that is a fact.
    expect(harness.audit.all().map((row) => row.action)).toContain('source.refreshed');
  });

  it('refuses a second refresh inside the manual floor (D-27)', async () => {
    // A last-run timestamp is what the floor measures from.
    harness.database.db.raw
      .prepare(
        `update source_state set last_run_at = ?
          where source_id = (select id from sources where key = 'devpost')`,
      )
      .run(Date.now());
    const answer = await call('POST', '/api/v1/admin/sources/devpost/refresh', {
      token: adminToken,
    });
    expect(answer.status).toBe(429);
    expect(answer.body.code).toBe('SOURCE_REFRESH_TOO_SOON');
  });

  it('answers 404 for a key that does not exist', async () => {
    const answer = await call('POST', '/api/v1/admin/sources/nosuch/refresh', {
      token: adminToken,
    });
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('SOURCE_NOT_FOUND');
  });
});
