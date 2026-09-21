import { CategoryList, CategoryRulePreview, SearchResponse } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyCategorySeed, loadCategorySeed } from '../modules/categories/seed.js';
import { EventsRepository } from '../modules/events/repository.js';
import { CATEGORY_SEED_FILE } from '../testing/search.js';
import { startSetupTestServer, type SetupTestServer } from '../testing/setup-server.js';

/**
 * `/admin/categories` and `/admin/category-rules` over a real socket (§10.2
 * "categories & rules", D-15, WP-15b): administrators only, every write
 * audited, a refused write leaves no audit row, the preview writes nothing.
 */

const ADMIN_PASSWORD = 'the-first-admin-password';
const PROFESSOR_PASSWORD = 'a-professor-chosen-password';
const UUID = '01920000-0000-7000-8000-000000000001';

let harness: SetupTestServer;
let admin: string;
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

const count = (sql: string): number =>
  (harness.database.db.raw.prepare(sql).get() as { n: number }).n;
const auditCount = (): number =>
  count(`SELECT count(*) AS n FROM audit_log WHERE entity_kind IN ('category', 'category_rule')`);

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

  applyCategorySeed(harness.database.db, loadCategorySeed(CATEGORY_SEED_FILE), 1);
  harness.categories.classifier.rulesChanged();
  const events = new EventsRepository(harness.database.db);
  const add = (title: string, visibility: 'VISIBLE' | 'ADMIN_HIDDEN' = 'VISIBLE') =>
    events.insert({
      title,
      normalizedTitle: title.toLowerCase(),
      eventType: 'HACKATHON',
      isRecurringRound: false,
      visibility,
      qualityScore: 50,
      firstSeenAt: 1,
      lastChangedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  for (const title of [
    'AI for Good Hackathon',
    'Robocon India 2026',
    'Robowars Night',
    'Chair Design Sprint',
  ])
    add(title);
  add('Hidden Robotics Hackathon', 'ADMIN_HIDDEN');
  harness.categories.classifier.requestReclassification('test', null);
  await harness.categories.classifier.processPending();
  harness.search.vocabulary.refresh();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe('permissions', () => {
  it('a professor is refused every /admin/categor* route with 403, and nothing is audited', async () => {
    const before = auditCount();
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/v1/admin/categories'],
      ['POST', '/api/v1/admin/categories', { name: 'X', slug: 'x', colorToken: 'category-1' }],
      ['PATCH', `/api/v1/admin/categories/${UUID}`, { name: 'Y' }],
      ['DELETE', `/api/v1/admin/categories/${UUID}`],
      ['GET', '/api/v1/admin/category-rules'],
      [
        'POST',
        '/api/v1/admin/category-rules',
        { categoryId: UUID, kind: 'KEYWORD', pattern: 'x', weight: 10 },
      ],
      ['PATCH', `/api/v1/admin/category-rules/${UUID}`, { weight: 10 }],
      ['DELETE', `/api/v1/admin/category-rules/${UUID}`],
      ['POST', '/api/v1/admin/category-rules/preview', { kind: 'KEYWORD', pattern: 'ai' }],
    ];
    for (const [method, route, body] of routes) {
      const answer = await call(method, route, {
        token: professor,
        ...(body === undefined ? {} : { body }),
      });
      expect({ route: `${method} ${route}`, status: answer.status }).toEqual({
        route: `${method} ${route}`,
        status: 403,
      });
    }
    expect(auditCount()).toBe(before);
  });
});

describe('the admin API', () => {
  it('lists the seeded taxonomy with event counts', async () => {
    const answer = await call('GET', '/api/v1/admin/categories', { token: admin });
    const list = CategoryList.parse(answer.body);
    expect(list.items).toHaveLength(12);
    expect(list.items.find((category) => category.slug === 'robotics')?.eventCount).toBe(2);
  });

  it('creates, refuses a duplicate, edits and — when in use — refuses to delete without ?reassign=', async () => {
    const before = auditCount();
    const created = await call('POST', '/api/v1/admin/categories', {
      token: admin,
      body: { name: 'Health Tech', slug: 'health-tech', colorToken: 'category-3' },
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const duplicate = await call('POST', '/api/v1/admin/categories', {
      token: admin,
      body: { name: 'Other name', slug: 'health-tech', colorToken: 'category-3' },
    });
    expect([duplicate.status, duplicate.body.code]).toEqual([409, 'CONFLICT']);
    const patched = await call('PATCH', `/api/v1/admin/categories/${id}`, {
      token: admin,
      body: { name: 'HealthTech' },
    });
    expect(patched.body.name).toBe('HealthTech');

    const rule = await call('POST', '/api/v1/admin/category-rules', {
      token: admin,
      body: { categoryId: id, kind: 'KEYWORD', pattern: 'robocon', weight: 60 },
    });
    expect(rule.status).toBe(201);
    await harness.categories.classifier.processPending();

    const inUse = await call('DELETE', `/api/v1/admin/categories/${id}`, { token: admin });
    expect([inUse.status, inUse.body.code]).toEqual([409, 'CATEGORY_IN_USE']);

    const robotics =
      CategoryList.parse(
        (await call('GET', '/api/v1/admin/categories', { token: admin })).body,
      ).items.find((category) => category.slug === 'robotics')?.id ?? '';
    const moved = await call('DELETE', `/api/v1/admin/categories/${id}?reassign=${robotics}`, {
      token: admin,
    });
    expect(moved.status).toBe(204);
    expect(count(`SELECT count(*) AS n FROM categories WHERE slug = 'health-tech'`)).toBe(0);

    const actions = harness.database.db.raw
      .prepare(
        `SELECT action FROM audit_log WHERE entity_kind IN ('category', 'category_rule') ORDER BY occurred_at, id`,
      )
      .all()
      .slice(before) as { action: string }[];
    // One row per successful write; the duplicate and the refused delete left none.
    expect(actions.map((row) => row.action)).toEqual([
      'category.created',
      'category.updated',
      'category.rule.created',
      'category.deleted',
    ]);
  });

  it('refuses an unsafe REGEX and a meaningless KEYWORD at write time', async () => {
    const categoryId = CategoryList.parse(
      (await call('GET', '/api/v1/admin/categories', { token: admin })).body,
    ).items[0]?.id;
    const before = auditCount();
    const unsafe = await call('POST', '/api/v1/admin/category-rules', {
      token: admin,
      body: { categoryId, kind: 'REGEX', pattern: '(a+)+$', weight: 50 },
    });
    expect([unsafe.status, unsafe.body.code]).toEqual([400, 'SEARCH_RULE_PATTERN_UNSAFE']);
    const invalid = await call('POST', '/api/v1/admin/category-rules', {
      token: admin,
      body: { categoryId, kind: 'KEYWORD', pattern: 'two words', weight: 50 },
    });
    expect([invalid.status, invalid.body.code]).toEqual([400, 'SEARCH_INVALID_RULE']);
    const preview = await call('POST', '/api/v1/admin/category-rules/preview', {
      token: admin,
      body: { kind: 'REGEX', pattern: '(\\w+\\s?)*$' },
    });
    expect([preview.status, preview.body.code]).toEqual([400, 'SEARCH_RULE_PATTERN_UNSAFE']);
    expect(auditCount()).toBe(before);
  });

  it('a rule edit and a rule delete are audited and re-classify', async () => {
    const rules = (await call('GET', '/api/v1/admin/category-rules', { token: admin })).body
      .items as { id: string; pattern: string }[];
    const robocon = rules.find((rule) => rule.pattern === 'robocon');
    const patched = await call('PATCH', `/api/v1/admin/category-rules/${robocon?.id ?? ''}`, {
      token: admin,
      body: { weight: 90 },
    });
    expect(patched.body.weight).toBe(90);
    expect(harness.categories.repo.pendingRun()).toBeDefined();
    const removed = await call('DELETE', `/api/v1/admin/category-rules/${robocon?.id ?? ''}`, {
      token: admin,
    });
    expect(removed.status).toBe(204);
    expect(
      count(
        `SELECT count(*) AS n FROM audit_log WHERE action IN ('category.rule.updated', 'category.rule.deleted')`,
      ),
    ).toBe(2);
  });
});

describe('POST /admin/category-rules/preview', () => {
  it('shows the first matches of a rule not yet saved, hidden events left out, and writes nothing', async () => {
    const snapshot = () => [
      count('SELECT count(*) AS n FROM event_categories'),
      count('SELECT count(*) AS n FROM category_rules'),
      count('SELECT count(*) AS n FROM audit_log'),
      count('SELECT count(*) AS n FROM category_reclassify_runs'),
    ];
    const before = snapshot();
    const answer = await call('POST', '/api/v1/admin/category-rules/preview', {
      token: admin,
      body: { kind: 'REGEX', pattern: '\\brobo(tics|wars?|con)\\b', fields: 'TITLE' },
    });
    expect(answer.status).toBe(200);
    const preview = CategoryRulePreview.parse(answer.body);
    expect(preview.items.map((item) => [item.title, item.matchedIn])).toEqual([
      ['Robocon India 2026', 'TITLE'],
      ['Robowars Night', 'TITLE'],
    ]);
    expect(preview.scanned).toBe(4);
    expect(snapshot()).toEqual(before);
  });
});

describe('search over HTTP', () => {
  it('answers ranked items with reasons and facets; the category filter works', async () => {
    const answer = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { categories: ['ai-ml'] },
    });
    const response = SearchResponse.parse(answer.body);
    expect(response.items.map((item) => item.title)).toEqual(['AI for Good Hackathon']);
    expect(response.items[0]?.reasons.length).toBeGreaterThan(0);
    expect(response.facets?.category.find((entry) => entry.value === 'robotics')?.count).toBe(2);
    const cheap = await call('POST', '/api/v1/search/events', {
      token: professor,
      body: { facets: false },
    });
    expect(cheap.body.facets).toBeUndefined();
  });
});
