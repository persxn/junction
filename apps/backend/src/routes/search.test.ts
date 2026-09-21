import { EventCore, SearchResponse } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventsRepository } from '../modules/events/repository.js';
import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * `/search/events`, `/events/:id` and `/admin/search-aliases` over a real
 * socket (§8, §10.2, WP-15a). One installation for the file — Argon2id is
 * expensive on purpose and none of these cases is about passwords.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PROFESSOR_PASSWORD = 'a-professor-chosen-password';

let harness: SetupTestServer;
let adminToken: string;
let professor: string;
let eventId: string;
let hiddenId: string;

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

  const events = new EventsRepository(harness.database.db);
  const base = {
    eventType: 'HACKATHON' as const,
    isRecurringRound: false,
    qualityScore: 50,
    firstSeenAt: 1,
    lastChangedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  for (let index = 0; index < 3; index += 1) {
    const id = events.insert({
      ...base,
      title: `Route Hackathon ${String(index)}`,
      normalizedTitle: `route hackathon ${String(index)}`,
      visibility: 'VISIBLE',
      fields: { mode: 'OFFLINE', lat: 13.08, lon: 80.27, geoPrecision: 'CITY' },
    });
    eventId ??= id;
  }
  hiddenId = events.insert({
    ...base,
    title: 'Hidden Hackathon',
    normalizedTitle: 'hidden hackathon',
    visibility: 'ADMIN_HIDDEN',
  });
  harness.search.vocabulary.refresh();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('POST /search/events', () => {
  it('answers a SearchResponse to any signed-in user, hidden events left out', async () => {
    const answer = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { text: 'hackathon', limit: 2 },
    });
    expect(answer.status).toBe(200);
    const response = SearchResponse.parse(answer.body);
    expect(response.total).toBe(3);
    expect(response.items).toHaveLength(2);
    expect(response.nextCursor).toBeDefined();
    expect(response.items.every((item) => item.title !== 'Hidden Hackathon')).toBe(true);
  });

  it('measures distance from the configured primary campus', async () => {
    const answer = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { maxDistanceKm: 400, sort: 'DISTANCE' },
    });
    const response = SearchResponse.parse(answer.body);
    expect(response.items[0]?.distanceKm).toBeGreaterThan(250);
  });

  it('answers the typo correction in the body', async () => {
    const answer = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { text: 'hackthon' },
    });
    expect(SearchResponse.parse(answer.body).correction?.usedTerm).toBe('hackathon');
  });

  it('refuses a bad query with SEARCH_ codes, never VALIDATION_FAILED', async () => {
    const strict = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { text: 'x', colour: 'red' },
    });
    expect(strict.status).toBe(400);
    expect(strict.body.code).toBe('SEARCH_INVALID_QUERY');
    expect(strict.body.errors).toBeDefined();

    const long = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { text: 'x'.repeat(201) },
    });
    expect([long.status, long.body.code]).toEqual([400, 'SEARCH_TEXT_TOO_LONG']);

    const cursor = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { cursor: 'eyJ2IjoxfQ.AAAA' },
    });
    expect([cursor.status, cursor.body.code]).toEqual([400, 'SEARCH_INVALID_CURSOR']);
  });

  it('needs a session', async () => {
    const answer = await call('POST', '/api/v1/search/events', { body: {} });
    expect(answer.status).toBe(401);
  });
});

describe('GET /events/:id', () => {
  it('returns the core event', async () => {
    const answer = await call('GET', `/api/v1/events/${eventId}`, { token: professor });
    expect(answer.status).toBe(200);
    expect(EventCore.parse(answer.body).id).toBe(eventId);
  });

  it('is EVENT_NOT_FOUND for a hidden event', async () => {
    const answer = await call('GET', `/api/v1/events/${hiddenId}`, { token: professor });
    expect([answer.status, answer.body.code]).toEqual([404, 'EVENT_NOT_FOUND']);
  });
});

describe('/admin/search-aliases', () => {
  it('is administrators only, reads included', async () => {
    expect((await call('GET', '/api/v1/admin/search-aliases', { token: professor })).status).toBe(
      403,
    );
    const put = await call('PUT', '/api/v1/admin/search-aliases/iot', {
      token: professor,
      body: { expansions: ['internet of things'] },
    });
    expect(put.status).toBe(403);
    expect(
      (await call('DELETE', '/api/v1/admin/search-aliases/ml', { token: professor })).status,
    ).toBe(403);
  });

  it('lists, creates, refuses a duplicate, replaces and deletes — each write audited', async () => {
    const list = await call('GET', '/api/v1/admin/search-aliases', { token: adminToken });
    expect((list.body.items as { term: string }[]).map((item) => item.term)).toEqual([
      'ctf',
      'genai',
      'ml',
    ]);

    const created = await call('PUT', '/api/v1/admin/search-aliases/IoT', {
      token: adminToken,
      body: { expansions: ['Internet of Things'] },
    });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ term: 'iot', expansions: ['internet of things'] });

    const duplicate = await call('PUT', '/api/v1/admin/search-aliases/iot', {
      token: adminToken,
      body: { expansions: ['embedded'] },
    });
    expect([duplicate.status, duplicate.body.code]).toEqual([409, 'SEARCH_ALIAS_EXISTS']);

    const replaced = await call('PUT', '/api/v1/admin/search-aliases/iot', {
      token: adminToken,
      body: { expansions: ['embedded'], replace: true },
    });
    expect(replaced.body).toEqual({ term: 'iot', expansions: ['embedded'] });

    expect(
      (await call('DELETE', '/api/v1/admin/search-aliases/iot', { token: adminToken })).status,
    ).toBe(204);
    expect(
      (await call('DELETE', '/api/v1/admin/search-aliases/iot', { token: adminToken })).status,
    ).toBe(404);

    const audited = harness.database.db.raw
      .prepare(
        `SELECT action FROM audit_log WHERE entity_kind = 'search_alias' ORDER BY occurred_at, id`,
      )
      .all() as { action: string }[];
    expect(audited.map((row) => row.action)).toEqual([
      'search.alias.created',
      'search.alias.replaced',
      'search.alias.deleted',
    ]);
  });
});
