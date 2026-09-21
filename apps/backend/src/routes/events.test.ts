import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * `/events` and `/events/import/*` over a real socket (§10.2, D-30, WP-14).
 *
 * One installation for the whole file: Argon2id is deliberately expensive
 * (§4.12), and none of these cases is about passwords. The import service here
 * has an empty adapter registry and a transport that answers nothing, which is
 * on purpose — every case below is about who may call, what the body must look
 * like and what a refusal says, and a request that reached the network would
 * mean the dispatch had already gone wrong.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PROFESSOR_PASSWORD = 'a-professor-chosen-password';

let harness: SetupTestServer;
let adminToken: string;
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
  return answer.body.token as string;
}

beforeAll(async () => {
  harness = await startSetupTestServer();
  await call('POST', '/api/v1/setup/complete', {
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
      backupPassphrase: 'a-different-backup-passphrase',
    },
  });
  adminToken = await signIn('admin@example.edu', ADMIN_PASSWORD);
  const created = await call('POST', '/api/v1/admin/users', {
    token: adminToken,
    body: { email: 'professor@example.edu', displayName: 'A. Professor', roles: ['PROFESSOR'] },
  });
  const temporary = created.body.temporaryPassword as string;
  const first = await signIn('professor@example.edu', temporary);
  await call('POST', '/api/v1/auth/change-password', {
    token: first,
    body: { currentPassword: temporary, newPassword: PROFESSOR_PASSWORD },
  });
  professor = await signIn('professor@example.edu', PROFESSOR_PASSWORD);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const EVENT = {
  title: 'Department Ideathon 2026',
  eventType: 'IDEATHON',
  startsAt: { at: '2026-10-20T09:00:00+05:30' },
};

describe('POST /events', () => {
  it('needs a session', async () => {
    expect((await call('POST', '/api/v1/events', { body: EVENT })).status).toBe(401);
  });

  it('is a professor’s to use (§10.2 "add manual events")', async () => {
    const answer = await call('POST', '/api/v1/events', { token: professor, body: EVENT });
    expect(answer.status).toBe(200);
    expect(answer.body.sourceKey).toBe('manual');
    expect(answer.body.created).toBe(true);
    expect(answer.body.overriddenFields).toContain('title');
  });

  it('refuses an event with nothing to find it by again', async () => {
    const answer = await call('POST', '/api/v1/events', {
      token: professor,
      body: { title: 'Just a title' },
    });
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a field the form does not have, rather than ignoring it', async () => {
    const answer = await call('POST', '/api/v1/events', {
      token: professor,
      body: { ...EVENT, contactEmail: 'someone@example.edu' },
    });
    expect(answer.status).toBe(400);
  });
});

describe('POST /events/import/preview', () => {
  it('answers a Devpost link with a banner state, not an error (D-30)', async () => {
    const answer = await call('POST', '/api/v1/events/import/preview', {
      token: professor,
      body: { url: 'https://devpost.com/software/codestorm' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.disposition).toBe('MANUAL_ONLY');
    expect(answer.body.sourceKey).toBe('devpost');
    expect(String(answer.body.reason)).toContain("doesn't allow automated reading");
  });

  it('renders a refusal as RFC 9457 problem details (R5, R12)', async () => {
    const answer = await call('POST', '/api/v1/events/import/preview', {
      token: professor,
      body: { url: 'http://devpost.com/software/codestorm' },
    });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({
      type: 'urn:compintel:problem:IMPORT_URL_INVALID',
      code: 'IMPORT_URL_INVALID',
      status: 400,
    });
    expect(answer.body.requestId).toBeDefined();
    expect(answer.body.hint).toContain('by hand');
  });

  it('needs a session', async () => {
    const answer = await call('POST', '/api/v1/events/import/preview', {
      body: { url: 'https://devpost.com/x' },
    });
    expect(answer.status).toBe(401);
  });
});

describe('POST /events/import/commit', () => {
  it('refuses a domain we do not read automatically, whatever the body claims', async () => {
    const answer = await call('POST', '/api/v1/events/import/commit', {
      token: professor,
      body: {
        url: 'https://devpost.com/software/codestorm',
        disposition: 'GENERIC',
        fields: { title: 'Sneaky', officialUrl: 'https://devpost.com/software/codestorm' },
        edited: [],
      },
    });
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('IMPORT_DOMAIN_MANUAL_ONLY');
  });

  it('refuses an override field that is not a field', async () => {
    const answer = await call('POST', '/api/v1/events/import/commit', {
      token: professor,
      body: {
        url: 'https://example.edu/e',
        disposition: 'GENERIC',
        fields: { title: 'x', officialUrl: 'https://example.edu/e' },
        edited: ['not_a_field'],
      },
    });
    expect(answer.status).toBe(400);
  });
});
