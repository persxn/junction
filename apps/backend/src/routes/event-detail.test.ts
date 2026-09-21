import { EventDetailView, SourceStatusResponse } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ingestInto, loadScenario, toCandidate } from '../testing/events.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { insertSource } from '../testing/scraping.js';
import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * `GET /events/:id/detail` and `PUT /events/:id/categories` over a real socket,
 * on the WP-16b conflict fixture (§19's acceptance criterion).
 *
 * The drawer's whole payload is parsed with the contract's schema, so a shape
 * that drifted would fail here rather than in a professor's browser.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PASSWORD = 'a-professor-chosen-password';

let harness: SetupTestServer;
let professorToken: string;
let adminToken: string;
let eventId: string;

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

const detail = async (token = professorToken): Promise<EventDetailView> => {
  const answer = await call('GET', `/api/v1/events/${eventId}/detail`, { token });
  expect(answer.status).toBe(200);
  return EventDetailView.parse(answer.body);
};

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
    body: { email: 'pat@example.edu', displayName: 'Pat', roles: ['PROFESSOR'] },
  });
  const temporary = created.body.temporaryPassword as string;
  const first = await signIn('pat@example.edu', temporary);
  await call('POST', '/api/v1/auth/change-password', {
    token: first,
    body: { currentPassword: temporary, newPassword: PASSWORD },
  });
  professorToken = await signIn('pat@example.edu', PASSWORD);

  // The conflict fixture, through the same per-item transaction a scrape uses.
  const scenario = loadScenario('three-sources-disagree', 'conflicts');
  const sources = new SourcesRepository(harness.database.db);
  const records = new SourceRecordsRepository(harness.database.db);
  for (const extra of scenario.sources) {
    if (sources.findByKey(extra.key) === undefined) {
      insertSource(harness.database.db, {
        key: extra.key,
        name: extra.key,
        trustRank: extra.trustRank,
        adapter: extra.adapter,
      });
    }
  }
  let last: string | null = null;
  for (const entry of scenario.records) {
    last = ingestInto({
      records,
      source: sources.findByKey(entry.sourceKey)!,
      linker: harness.events.linker,
      candidate: toCandidate(entry.sourceKey, entry.externalKey, entry.candidate),
      at: Date.parse('2026-09-01T00:00:00.000Z'),
    }).eventId;
  }
  if (last === null) {
    throw new Error('the conflict fixture produced no event');
  }
  eventId = last;
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('GET /events/:id/detail', () => {
  it('needs a session', async () => {
    expect((await call('GET', `/api/v1/events/${eventId}/detail`)).status).toBe(401);
  });

  it('answers the whole drawer in one round trip, in the contract shape', async () => {
    const view = await detail();
    expect(view.id).toBe(eventId);
    expect(view.hasConflicts).toBe(true);
    expect(view.sources).toHaveLength(3);
    expect(view.claims.length).toBeGreaterThan(0);
    expect(view.deadlines.length).toBeGreaterThan(0);
  });

  it('names every disagreeing source and why the selected value won (§7.5)', async () => {
    const view = await detail();
    const fields = view.conflicts.map((conflict) => conflict.field);
    expect(fields).toContain('registrationDeadlineAt');
    expect(fields).toContain('prizeText');
    expect(fields).toContain('teamMax');
    for (const conflict of view.conflicts) {
      expect(conflict.values.length).toBeGreaterThanOrEqual(2);
      expect(conflict.selectedReason).toBe('HIGHEST_TRUST');
      expect(conflict.selectedSourceName).toBe('hackxyz-site');
    }
  });

  it('answers 404 for an event nobody may see', async () => {
    const answer = await call('GET', '/api/v1/events/0192a000-0000-7000-8000-00000000dead/detail', {
      token: professorToken,
    });
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('EVENT_NOT_FOUND');
  });
});

describe('PUT /events/:id/categories', () => {
  it('lets a professor add one, remove it again, and refuses a stale version', async () => {
    // The category list is administered (§10.2); the assignment on one event is not.
    const created = await call('POST', '/api/v1/admin/categories', {
      token: adminToken,
      body: { name: 'Robotics', slug: 'robotics', colorToken: 'ci-accent' },
    });
    expect(created.status).toBe(201);
    const robotics = created.body.id as string;

    const before = await detail();
    const added = await call('PUT', `/api/v1/events/${eventId}/categories`, {
      token: professorToken,
      body: { categoryIds: [robotics], version: before.version },
    });
    expect(added.status).toBe(200);
    expect(added.body.categories).toEqual([
      { id: robotics, name: 'Robotics', slug: 'robotics', origin: 'MANUAL', isSuppressed: false },
    ]);
    expect(added.body.version).toBe(before.version + 1);

    const removed = await call('PUT', `/api/v1/events/${eventId}/categories`, {
      token: professorToken,
      body: { categoryIds: [], version: before.version + 1 },
    });
    expect(removed.status).toBe(200);
    expect(
      (removed.body.categories as { isSuppressed: boolean }[]).every((row) => row.isSuppressed),
    ).toBe(true);

    const stale = await call('PUT', `/api/v1/events/${eventId}/categories`, {
      token: professorToken,
      body: { categoryIds: [robotics], version: before.version },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('EVENT_VERSION_CONFLICT');
  });

  it('needs a session', async () => {
    const answer = await call('PUT', `/api/v1/events/${eventId}/categories`, {
      body: { categoryIds: [], version: 1 },
    });
    expect(answer.status).toBe(401);
  });
});

describe('GET /sources/status', () => {
  it('carries the overall freshness and omits compliance for a professor', async () => {
    const answer = await call('GET', '/api/v1/sources/status', { token: professorToken });
    expect(answer.status).toBe(200);
    const body = SourceStatusResponse.parse(answer.body);
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.sources.every((source) => source.complianceStatus === undefined)).toBe(true);
    // The manual pseudo-sources are in the response; the §16.1 popover filters them.
    expect(body.sources.map((source) => source.adapter)).toContain('MANUAL');
    expect(body.offline).toBe(false);

    const asAdmin = SourceStatusResponse.parse(
      (await call('GET', '/api/v1/sources/status', { token: adminToken })).body,
    );
    expect(asAdmin.sources.every((source) => source.complianceStatus !== undefined)).toBe(true);
  });
});
