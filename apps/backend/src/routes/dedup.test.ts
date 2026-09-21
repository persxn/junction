import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { ingestInto, loadScenario, toCandidate } from '../testing/events.js';
import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * The duplicate review API over a real socket (§10.2, §7.5, R66).
 *
 * One installation for the file, as in `sources.test.ts`: Argon2id makes a
 * wizard run per test cost more than everything else here together. Each case
 * builds its own events, so the order does not matter.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PROFESSOR_PASSWORD = 'a-professor-chosen-password';

let harness: SetupTestServer;
let admin: string;
let professor: string;
let clock = Date.parse('2026-09-01T00:00:00Z');

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

let pairs = 0;

/** An ISO instant moved by whole days, so each pair lives in its own date window. */
function shifted(iso: string | undefined, days: number): string | undefined {
  return iso === undefined
    ? undefined
    : new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

/**
 * The CodeStorm pair under fresh external keys and dates 10 days apart from the
 * previous pair's, so pairs never match each other; returns its PENDING row.
 */
function pendingPair(tag: string): {
  id: string;
  version: number;
  eventIdA: string;
  eventIdB: string;
} {
  pairs += 1;
  const offset = pairs * 10;
  const known = new Set(harness.events.candidates.list('PENDING', 1000, 0).map((row) => row.id));
  const db = harness.database.db;
  const records = new SourceRecordsRepository(db);
  const sources = new SourcesRepository(db);
  const [internal, national] = loadScenario('internal-round-vs-national-round').records;
  for (const entry of [internal!, national!]) {
    clock += 60_000;
    ingestInto({
      records,
      source: sources.findByKey(entry.sourceKey)!,
      linker: harness.events.linker,
      candidate: toCandidate(entry.sourceKey, `${entry.externalKey}-${tag}`, {
        ...entry.candidate,
        ...(entry.candidate.startsAt === undefined
          ? {}
          : { startsAt: shifted(entry.candidate.startsAt, offset)! }),
        ...(entry.candidate.endsAt === undefined
          ? {}
          : { endsAt: shifted(entry.candidate.endsAt, offset)! }),
        ...(entry.candidate.registrationDeadlineAt === undefined
          ? {}
          : { registrationDeadlineAt: shifted(entry.candidate.registrationDeadlineAt, offset)! }),
      }),
      at: clock,
    });
  }
  const fresh = harness.events.candidates
    .list('PENDING', 1000, 0)
    .filter((candidate) => !known.has(candidate.id));
  const row = fresh[0];
  if (row === undefined || fresh.length !== 1) {
    throw new Error(`pair ${tag} raised no new PENDING candidate`);
  }
  return { id: row.id, version: row.version, eventIdA: row.eventIdA, eventIdB: row.eventIdB };
}

function auditCount(): number {
  return harness.audit.all().length;
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
        displayName: 'The Administrator',
        password: ADMIN_PASSWORD,
      },
      scraperContactEmail: 'compintel@example.edu',
      backupDir: harness.backupDir,
      backupPassphrase: 'a-different-backup-passphrase',
    },
  });
  if (complete.status !== 200) {
    throw new Error(`setup failed: ${JSON.stringify(complete.body)}`);
  }
  admin = await signIn('admin@example.edu', ADMIN_PASSWORD);
  const created = await call('POST', '/api/v1/admin/users', {
    token: admin,
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

describe('GET /admin/dedup/candidates', () => {
  it('lists PENDING pairs with both events, the score and its breakdown', async () => {
    const pair = pendingPair('list');
    const answer = await call('GET', '/api/v1/admin/dedup/candidates?status=PENDING&limit=100', {
      token: admin,
    });
    expect(answer.status).toBe(200);
    const items = answer.body.items as Record<string, unknown>[];
    const mine = items.find((item) => item.id === pair.id)!;
    expect(mine).toMatchObject({ status: 'PENDING', version: 1 });
    expect(Object.keys((mine.score as { features: object }).features).sort()).toEqual([
      'dateProximity',
      'locationMode',
      'organizer',
      'title',
      'urlMatch',
    ]);
    expect((mine.eventA as { sourceKeys: string[] }).sourceKeys.length).toBe(1);
    expect(answer.body.total).toBeGreaterThanOrEqual(1);
  });

  it('is admin only', async () => {
    const answer = await call('GET', '/api/v1/admin/dedup/candidates', { token: professor });
    expect(answer.status).toBe(403);
  });
});

describe('merge, reject and unmerge', () => {
  it('a professor gets 403 on every write, and nothing is audited', async () => {
    const pair = pendingPair('prof');
    const before = auditCount();
    for (const [route, body] of [
      [`/api/v1/admin/dedup/candidates/${pair.id}/merge`, { version: pair.version }],
      [`/api/v1/admin/dedup/candidates/${pair.id}/reject`, { version: pair.version }],
      [`/api/v1/admin/events/${pair.eventIdA}/unmerge`, { version: 1 }],
    ] as const) {
      const answer = await call('POST', route, { token: professor, body });
      expect(answer.status, route).toBe(403);
    }
    expect(auditCount()).toBe(before);
  });

  it('a stale version is a 409 EVENT_VERSION_CONFLICT', async () => {
    const pair = pendingPair('stale');
    const answer = await call('POST', `/api/v1/admin/dedup/candidates/${pair.id}/merge`, {
      token: admin,
      body: { version: pair.version + 1 },
    });
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('EVENT_VERSION_CONFLICT');
  });

  it('merge, then unmerge, each with exactly one audit row', async () => {
    const pair = pendingPair('merge');
    let before = auditCount();
    const merged = await call('POST', `/api/v1/admin/dedup/candidates/${pair.id}/merge`, {
      token: admin,
      body: { version: pair.version },
    });
    expect(merged.status).toBe(200);
    expect((merged.body.candidate as { status: string }).status).toBe('MERGED');
    expect(auditCount()).toBe(before + 1);

    const mergedId = merged.body.mergedId as string;
    const version = harness.events.events.getById(mergedId)!.version;
    before = auditCount();
    const undone = await call('POST', `/api/v1/admin/events/${mergedId}/unmerge`, {
      token: admin,
      body: { version },
    });
    expect(undone.status).toBe(200);
    expect(undone.body).toEqual({ restoredId: mergedId, fromEventId: merged.body.survivorId });
    expect(auditCount()).toBe(before + 1);
    expect(harness.audit.verifyChain().ok).toBe(true);
  });

  it('merging an already-merged event is EVENT_ALREADY_MERGED', async () => {
    const pair = pendingPair('twice');
    const merged = await call('POST', `/api/v1/admin/dedup/candidates/${pair.id}/merge`, {
      token: admin,
      body: { version: pair.version },
    });
    const mergedId = merged.body.mergedId as string;
    const other = harness.events.events
      .allEvents()
      .find((event) => event.id !== mergedId && event.id !== merged.body.survivorId)!;
    const extra = harness.events.candidates.insertIfAbsent(
      mergedId,
      other.id,
      0.75,
      { title: 0.5, organizer: 0.5, dateProximity: 1, locationMode: 0.5, urlMatch: false },
      clock,
    )!;
    const answer = await call('POST', `/api/v1/admin/dedup/candidates/${extra.id}/merge`, {
      token: admin,
      body: { version: extra.version },
    });
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('EVENT_ALREADY_MERGED');
  });

  it('unmerging a never-merged event is EVENT_NOT_MERGED', async () => {
    const pair = pendingPair('never');
    const event = harness.events.events.getById(pair.eventIdA)!;
    const answer = await call('POST', `/api/v1/admin/events/${event.id}/unmerge`, {
      token: admin,
      body: { version: event.version },
    });
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('EVENT_NOT_MERGED');
  });

  it('reject leaves both events and marks the pair REJECTED', async () => {
    const pair = pendingPair('reject');
    const answer = await call('POST', `/api/v1/admin/dedup/candidates/${pair.id}/reject`, {
      token: admin,
      body: { version: pair.version },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.status).toBe('REJECTED');
    expect(harness.events.events.getById(pair.eventIdA)?.visibility).toBe('VISIBLE');
    expect(harness.events.events.getById(pair.eventIdB)?.visibility).toBe('VISIBLE');
  });
});

describe('GET /events/:id/conflicts and /events/:id/changes', () => {
  it("any signed-in user may read an event's conflicts", async () => {
    const pair = pendingPair('conflicts');
    const answer = await call('GET', `/api/v1/events/${pair.eventIdA}/conflicts`, {
      token: professor,
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      eventId: pair.eventIdA,
      hasConflicts: false,
      conflicts: [],
    });
  });

  it('pages the change history newest first with a cursor', async () => {
    const pair = pendingPair('changes');
    const merged = await call('POST', `/api/v1/admin/dedup/candidates/${pair.id}/merge`, {
      token: admin,
      body: { version: pair.version },
    });
    const survivor = merged.body.survivorId as string;
    const first = await call('GET', `/api/v1/events/${survivor}/changes?limit=1`, {
      token: professor,
    });
    expect(first.status).toBe(200);
    const items = first.body.items as { cause: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.cause).toBe('MERGE');
    if (first.body.nextCursor !== null) {
      const second = await call(
        'GET',
        `/api/v1/events/${survivor}/changes?limit=1&cursor=${first.body.nextCursor as string}`,
        { token: professor },
      );
      expect(second.status).toBe(200);
    }
  });

  it('an unknown event is a 404 EVENT_NOT_FOUND', async () => {
    const answer = await call(
      'GET',
      '/api/v1/events/01900000-0000-7000-8000-000000000000/conflicts',
      {
        token: admin,
      },
    );
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('EVENT_NOT_FOUND');
  });
});
