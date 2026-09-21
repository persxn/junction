import { EventUserState, SearchResponse, WatchlistEntry } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventsRepository } from '../modules/events/repository.js';
import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * A professor's own Save and Hide over a real socket (§10.2, WP-16a):
 * idempotent writes, rows scoped to the caller, 401 without a session, and the
 * same 404 as the detail route for an event the caller cannot see.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PASSWORD = 'a-professor-chosen-password';

let harness: SetupTestServer;
let alice: string;
let bob: string;
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

async function professor(admin: string, email: string): Promise<string> {
  const created = await call('POST', '/api/v1/admin/users', {
    token: admin,
    body: { email, displayName: email, roles: ['PROFESSOR'] },
  });
  const temporary = created.body.temporaryPassword as string;
  const first = await signIn(email, temporary);
  await call('POST', '/api/v1/auth/change-password', {
    token: first,
    body: { currentPassword: temporary, newPassword: PASSWORD },
  });
  return signIn(email, PASSWORD);
}

const rows = (sql: string, ...params: unknown[]): unknown[] =>
  harness.database.db.raw.prepare(sql).all(...params);

const search = async (token: string, body: unknown = {}): Promise<SearchResponse> =>
  SearchResponse.parse((await call('POST', '/api/v1/search/events', { token, body })).body);

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
  const admin = await signIn('admin@example.edu', ADMIN_PASSWORD);
  alice = await professor(admin, 'alice@example.edu');
  bob = await professor(admin, 'bob@example.edu');

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
  eventId = events.insert({
    ...base,
    title: 'Saved Hackathon',
    normalizedTitle: 'saved hackathon',
    visibility: 'VISIBLE',
  });
  hiddenId = events.insert({
    ...base,
    title: 'Admin Hidden Hackathon',
    normalizedTitle: 'admin hidden hackathon',
    visibility: 'ADMIN_HIDDEN',
  });
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('without a session', () => {
  it('every route answers 401', async () => {
    for (const [method, path] of [
      ['PUT', `/api/v1/events/${eventId}/watchlist`],
      ['DELETE', `/api/v1/events/${eventId}/watchlist`],
      ['POST', `/api/v1/events/${eventId}/hide`],
      ['POST', `/api/v1/events/${eventId}/unhide`],
    ] as const) {
      expect((await call(method, path)).status).toBe(401);
    }
  });
});

describe('watchlist', () => {
  it('PUT is idempotent: twice is one row, and the second replaces the note', async () => {
    const first = await call('PUT', `/api/v1/events/${eventId}/watchlist`, { token: alice });
    expect(first.status).toBe(200);
    expect(WatchlistEntry.parse(first.body)).toMatchObject({ eventId, note: null });
    const second = await call('PUT', `/api/v1/events/${eventId}/watchlist`, {
      token: alice,
      body: { note: 'ask the third years' },
    });
    expect(second.body).toMatchObject({ note: 'ask the third years', addedAt: first.body.addedAt });
    expect(rows('SELECT user_id FROM watchlist_items WHERE event_id = ?', eventId)).toHaveLength(1);
  });

  it('search marks it saved for its owner only', async () => {
    expect((await search(alice)).items.find((item) => item.id === eventId)?.watchlisted).toBe(true);
    expect((await search(bob)).items.find((item) => item.id === eventId)?.watchlisted).toBe(false);
    expect((await search(alice, { watchlistedOnly: true })).items.map((item) => item.id)).toEqual([
      eventId,
    ]);
    expect((await search(bob, { watchlistedOnly: true })).items).toEqual([]);
  });

  it("another professor's DELETE removes only their own (absent) row", async () => {
    expect(
      (await call('DELETE', `/api/v1/events/${eventId}/watchlist`, { token: bob })).status,
    ).toBe(204);
    expect(rows('SELECT user_id FROM watchlist_items WHERE event_id = ?', eventId)).toHaveLength(1);
  });

  it('DELETE is idempotent', async () => {
    for (let i = 0; i < 2; i += 1) {
      const answer = await call('DELETE', `/api/v1/events/${eventId}/watchlist`, { token: alice });
      expect(answer.status).toBe(204);
    }
    expect(rows('SELECT 1 FROM watchlist_items WHERE event_id = ?', eventId)).toHaveLength(0);
  });
});

describe('hide', () => {
  it('hide is idempotent, scoped to the caller, and unhide restores it', async () => {
    for (let i = 0; i < 2; i += 1) {
      const answer = await call('POST', `/api/v1/events/${eventId}/hide`, {
        token: alice,
        body: { reason: 'not our level' },
      });
      expect(EventUserState.parse(answer.body)).toEqual({
        eventId,
        hidden: true,
        hiddenReason: 'not our level',
      });
    }
    const ids = async (token: string) =>
      (await search(token, { excludeHidden: true })).items.map((item) => item.id);
    expect(await ids(alice)).not.toContain(eventId);
    expect(await ids(bob)).toContain(eventId);

    const back = await call('POST', `/api/v1/events/${eventId}/unhide`, { token: alice });
    expect(back.body).toEqual({ eventId, hidden: false, hiddenReason: null });
    expect(await ids(alice)).toContain(eventId);
  });
});

describe('events the caller cannot see', () => {
  it('a hidden or unknown event is EVENT_NOT_FOUND, and nothing is written', async () => {
    for (const id of [hiddenId, '01920000-0000-7000-8000-00000000ffff']) {
      for (const [method, path] of [
        ['PUT', `/api/v1/events/${id}/watchlist`],
        ['POST', `/api/v1/events/${id}/hide`],
      ] as const) {
        const answer = await call(method, path, { token: alice });
        expect([answer.status, answer.body.code]).toEqual([404, 'EVENT_NOT_FOUND']);
      }
    }
    expect(rows('SELECT 1 FROM watchlist_items WHERE event_id = ?', hiddenId)).toHaveLength(0);
    expect(rows('SELECT 1 FROM event_user_state WHERE event_id = ?', hiddenId)).toHaveLength(0);
  });

  it('a body with unknown keys is refused', async () => {
    const answer = await call('PUT', `/api/v1/events/${eventId}/watchlist`, {
      token: alice,
      body: { note: 'x', userId: 'someone-else' },
    });
    expect(answer.status).toBe(400);
  });
});
