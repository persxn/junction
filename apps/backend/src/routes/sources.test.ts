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
  it('lists the seeded sources with their verdicts', async () => {
    const answer = await call('GET', '/api/v1/sources', { token: adminToken });
    expect(answer.status).toBe(200);
    const list = answer.body.sources as { key: string; complianceStatus: string }[];
    expect(list.map((entry) => entry.key).sort()).toEqual([
      'clist',
      'ctftime',
      'devfolio',
      'devpost',
      'manual',
      'unstop',
      'url-import',
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
  interface StatusEntry {
    key: string;
    health: string;
    lastSuccessAt: string | null;
    freshnessMinutes: number | null;
    consecutiveFailures: number;
    message: string;
    complianceStatus?: string;
    complianceNotes?: string;
  }

  const status = async (
    token: string,
  ): Promise<{ sources: StatusEntry[]; updatedAt: string | null; offline: boolean }> => {
    const answer = await call('GET', '/api/v1/sources/status', { token });
    expect(answer.status).toBe(200);
    return answer.body as { sources: StatusEntry[]; updatedAt: string | null; offline: boolean };
  };

  it('reports freshness, the next attempt and a §7.7 sentence for each source', async () => {
    const body = await status(adminToken);
    expect(body.sources).toHaveLength(7);
    const devpost = body.sources.find((entry) => entry.key === 'devpost');
    expect(devpost?.lastSuccessAt).toBeNull();
    expect(devpost?.freshnessMinutes).toBeNull();
    expect(devpost?.consecutiveFailures).toBe(0);
    expect(devpost?.message).toContain('disabled by policy');
    expect(devpost?.health).toBe('PAUSED_BY_POLICY');
    // Nothing has run on a fresh database, so there is no overall freshness yet.
    expect(body.updatedAt).toBeNull();
    expect(body.offline).toBe(false);
  });

  it('carries the compliance fields for an administrator', async () => {
    const devpost = (await status(adminToken)).sources.find((entry) => entry.key === 'devpost');
    expect(devpost?.complianceStatus).toBe('MANUAL_IMPORT_ONLY');
    expect(typeof devpost?.complianceNotes).toBe('string');
  });

  it('omits them — rather than nulling them — for a professor (§10.2)', async () => {
    const body = await status(professor);
    const devpost = body.sources.find((entry) => entry.key === 'devpost');
    expect(devpost).toBeDefined();
    expect(devpost && 'complianceStatus' in devpost).toBe(false);
    expect(devpost && 'complianceNotes' in devpost).toBe(false);
    // Everything a professor needs to read the freshness pill is still there.
    expect(devpost?.message).toContain('disabled by policy');
    expect(devpost?.health).toBe('PAUSED_BY_POLICY');
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
    const before = await source('devpost');
    const answer = await call('PATCH', '/api/v1/admin/sources/devpost', {
      token: professor,
      body: { isEnabled: true, version: before.version },
    });
    expect(answer.status).toBe(403);
    expect((await source('devpost')).isEnabled).toBe(false);
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

  it('refuses a write to config_json, where R77’s robots exemption lives', async () => {
    const before = await source('clist');
    for (const field of ['configJson', 'config_json', 'robotsExemption']) {
      const answer = await call('PATCH', '/api/v1/admin/sources/clist', {
        token: adminToken,
        body: { [field]: '{"robotsExemption":{"paths":["clist.by/"]}}', version: before.version },
      });
      expect(answer.status).toBe(400);
      expect(answer.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await source('clist')).version).toBe(before.version);
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

describe('/admin/sources/:key/credential (WP-11)', () => {
  const SECRET = 'a-clist-api-key-that-must-never-leak';

  it('GET says whether it is set and nothing else', async () => {
    const answer = await call('GET', '/api/v1/admin/sources/clist/credential', {
      token: adminToken,
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ isSet: false });
  });

  it('a professor may neither read nor set it', async () => {
    expect(
      (await call('GET', '/api/v1/admin/sources/clist/credential', { token: professor })).status,
    ).toBe(403);
    const put = await call('PUT', '/api/v1/admin/sources/clist/credential', {
      token: professor,
      body: { username: 'someone', apiKey: SECRET },
    });
    expect(put.status).toBe(403);
  });

  it('PUT stores it, is audited without the value, and never echoes the body', async () => {
    const answer = await call('PUT', '/api/v1/admin/sources/clist/credential', {
      token: adminToken,
      body: { username: 'compintel-dept', apiKey: SECRET },
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ isSet: true });
    expect(JSON.stringify(answer.body)).not.toContain(SECRET);

    const audit = harness.audit.all().filter((row) => row.action === 'source.credential.set');
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain('compintel-dept');

    const exported = JSON.stringify(harness.settings.exportableSettings());
    expect(exported).not.toContain(SECRET);
    expect(harness.settings.exportableSettings()['sources.clist.apiKey']).toEqual({ isSet: true });

    const list = await call('GET', '/api/v1/sources', { token: adminToken });
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
  });

  it('refuses a blank key and a source that takes no credential', async () => {
    const blank = await call('PUT', '/api/v1/admin/sources/clist/credential', {
      token: adminToken,
      body: { username: 'someone', apiKey: '   ' },
    });
    expect(blank.status).toBe(400);
    const ctftime = await call('PUT', '/api/v1/admin/sources/ctftime/credential', {
      token: adminToken,
      body: { username: 'someone', apiKey: 'x' },
    });
    expect(ctftime.status).toBe(409);
  });
});

/**
 * The professor's own session (R74/D-34, WP-14). Admin-only like every other
 * write here, and the cookie never comes back out of any of the three.
 */
describe('/admin/sources/:key/session', () => {
  const COOKIE = 'df_session=only-the-professor-has-this; other=1';

  it('refuses a professor on all three verbs (§10.2 source.manage)', async () => {
    expect(
      (await call('GET', '/api/v1/admin/sources/devfolio/session', { token: professor })).status,
    ).toBe(403);
    expect(
      (
        await call('PUT', '/api/v1/admin/sources/devfolio/session', {
          token: professor,
          body: { cookie: COOKIE },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('DELETE', '/api/v1/admin/sources/devfolio/session', { token: professor })).status,
    ).toBe(403);
  });

  it('answers state and nothing else before anybody has signed in', async () => {
    const answer = await call('GET', '/api/v1/admin/sources/devfolio/session', {
      token: adminToken,
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      supported: true,
      isSet: false,
      state: 'NONE',
      capturedAt: null,
      lastVerifiedAt: null,
      loginUrl: 'https://devfolio.co/login',
      hosts: ['devfolio.co', '*.devfolio.co'],
    });
  });

  it('stores one, audits the act without the value, and never echoes it', async () => {
    const put = await call('PUT', '/api/v1/admin/sources/devfolio/session', {
      token: adminToken,
      body: { cookie: COOKIE, capturedVia: 'LOGIN_WINDOW' },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ isSet: true, state: 'ACTIVE' });
    expect(JSON.stringify(put.body)).not.toContain('only-the-professor-has-this');

    const audit = harness.audit.all().filter((row) => row.action === 'source.session.set');
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('only-the-professor-has-this');
    expect(JSON.stringify(audit)).toContain('LOGIN_WINDOW');

    const exported = JSON.stringify(harness.settings.exportableSettings());
    expect(exported).not.toContain('only-the-professor-has-this');
  });

  it('signs the app out again, and audits that too', async () => {
    await call('PUT', '/api/v1/admin/sources/devfolio/session', {
      token: adminToken,
      body: { cookie: COOKIE },
    });
    const gone = await call('DELETE', '/api/v1/admin/sources/devfolio/session', {
      token: adminToken,
    });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ isSet: false, state: 'NONE' });
    expect(harness.audit.all().some((row) => row.action === 'source.session.cleared')).toBe(true);
  });

  it('refuses a source whose verdict does not allow signing in', async () => {
    const answer = await call('PUT', '/api/v1/admin/sources/ctftime/session', {
      token: adminToken,
      body: { cookie: COOKIE },
    });
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('CONFLICT');
  });

  it('refuses an empty cookie before the service sees it', async () => {
    const answer = await call('PUT', '/api/v1/admin/sources/devfolio/session', {
      token: adminToken,
      body: { cookie: '   ' },
    });
    expect(answer.status).toBe(400);
  });
});

/**
 * R74's one-time "Connect your sources" step (pre-M2a item 5).
 *
 * The screen is the professor's first sight of signing in to a source, so the
 * two things worth proving here are that it is offered exactly once and that
 * nobody without `source.manage` can close it for everybody.
 */
describe('the connect-sources prompt', () => {
  it('is pending on a fresh installation, and lists the sources that can hold a session', async () => {
    const answer = await call('GET', '/api/v1/sources/connect-prompt', { token: adminToken });
    expect(answer.status).toBe(200);
    expect(answer.body.pending).toBe(true);
    expect(answer.body.keys).toStrictEqual(['devfolio', 'unstop']);
  });

  it('is readable by a professor, who is not the one who closes it', async () => {
    const read = await call('GET', '/api/v1/sources/connect-prompt', { token: professor });
    expect(read.status).toBe(200);
    const refused = await call('POST', '/api/v1/admin/sources/connect-prompt/seen', {
      token: professor,
    });
    expect(refused.status).toBe(403);
    const still = await call('GET', '/api/v1/sources/connect-prompt', { token: adminToken });
    expect(still.body.pending).toBe(true);
  });

  it('needs a session at all', async () => {
    expect((await call('GET', '/api/v1/sources/connect-prompt')).status).toBe(401);
  });

  it('stays finished once it has been finished, and is audited once', async () => {
    const first = await call('POST', '/api/v1/admin/sources/connect-prompt/seen', {
      token: adminToken,
    });
    expect(first.status).toBe(200);
    expect(first.body.pending).toBe(false);

    // Pressing it twice — two windows, a reload — must not write a second row.
    const again = await call('POST', '/api/v1/admin/sources/connect-prompt/seen', {
      token: adminToken,
    });
    expect(again.body.pending).toBe(false);
    expect(
      harness.audit.all().filter((row) => row.action === 'source.connect_prompt.finished'),
    ).toHaveLength(1);

    const read = await call('GET', '/api/v1/sources/connect-prompt', { token: adminToken });
    expect(read.body.pending).toBe(false);
  });
});
