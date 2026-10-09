import type { MyInterestsView, SavedSearch, SavedSearchList } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InterestsRepository } from '../modules/interests/repo.js';
import { InterestsService } from '../modules/interests/service.js';
import { createNotificationsModule } from '../modules/notifications/wiring.js';
import { createSavedSearchesModule } from '../modules/saved-searches/wiring.js';
import { uuid7 } from '../platform/ids.js';
import { StreamHub } from '../platform/stream.js';
import type { TestServer } from '../testing/harness.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../testing/students.js';

/**
 * `/saved-searches` and `/me/interests` over HTTP (WP-24): owner only (another
 * person's id is 404), `version` → 409, a taken name → 409, the stored query
 * comes back as an `EventQuery`, and interests round-trip by category.
 */

let h: StudentsHarness;
let server: TestServer;
let categoryId: string;
beforeAll(async () => {
  h = openStudentsHarness();
  const hub = new StreamHub({ clock: h.clock });
  const notifications = createNotificationsModule({ db: h.database.db, hub, clock: h.clock });
  const saved = createSavedSearchesModule({
    db: h.database.db,
    search: h.search.service,
    notifications: notifications.engine,
    clock: h.clock,
  });
  const interests = new InterestsService({
    repo: new InterestsRepository(h.database.db),
    clock: h.clock,
  });
  server = await startStudentsServer(h, [], {
    savedSearches: () => saved.service,
    interests: () => interests,
  });
  categoryId = uuid7();
  h.database.db.raw
    .prepare(
      `INSERT INTO categories (id, name, slug, color_token, sort_order, is_active, created_at, updated_at)
       VALUES (?, 'AI/ML', 'ai-ml', 'accent', 0, 1, 0, 0)`,
    )
    .run(categoryId);
});
afterAll(async () => {
  await server.close();
  h.close();
});

const create = (name: string, as = h.alice) =>
  call(server, 'POST', '/api/v1/saved-searches', {
    as,
    body: { name, query: { text: 'hackathon', eventTypes: ['HACKATHON'], cursor: 'x', limit: 5 } },
  });

describe('/saved-searches', () => {
  it('refuses a request without a session', async () => {
    expect((await call(server, 'GET', '/api/v1/saved-searches')).status).toBe(401);
  });

  it('creates, lists, renames, toggles and deletes my own — never the cursor or page size', async () => {
    const created = await create('Hackathons');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const search = created.body as unknown as SavedSearch;
    expect(search).toMatchObject({ name: 'Hackathons', notifyOnNew: true, invalidQuery: false });
    expect(search.query).toStrictEqual({
      text: 'hackathon',
      eventTypes: ['HACKATHON'],
      limit: 25,
    });
    const list = await call(server, 'GET', '/api/v1/saved-searches', { as: h.alice });
    expect((list.body as unknown as SavedSearchList).items.map((item) => item.id)).toStrictEqual([
      search.id,
    ]);
    const patched = await call(server, 'PATCH', `/api/v1/saved-searches/${search.id}`, {
      as: h.alice,
      body: { version: search.version, name: 'Hackathons only', notifyOnNew: false },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Hackathons only', notifyOnNew: false, version: 2 });
    const stale = await call(server, 'PATCH', `/api/v1/saved-searches/${search.id}`, {
      as: h.alice,
      body: { version: 1, name: 'Again' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('SAVED_SEARCH_VERSION_CONFLICT');
    expect(
      (
        await call(server, 'DELETE', `/api/v1/saved-searches/${search.id}?version=1`, {
          as: h.alice,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(server, 'DELETE', `/api/v1/saved-searches/${search.id}?version=2`, {
          as: h.alice,
        })
      ).status,
    ).toBe(204);
  });

  it('answers 404 for another person’s search, on every route', async () => {
    const search = (await create('Mine')).body as unknown as SavedSearch;
    const path = `/api/v1/saved-searches/${search.id}`;
    const patch = await call(server, 'PATCH', path, { as: h.bob, body: { version: 1, name: 'x' } });
    expect(patch.status).toBe(404);
    expect(patch.body.code).toBe('SAVED_SEARCH_NOT_FOUND');
    expect((await call(server, 'DELETE', `${path}?version=1`, { as: h.bob })).status).toBe(404);
    const bobs = await call(server, 'GET', '/api/v1/saved-searches', { as: h.bob });
    expect((bobs.body as unknown as SavedSearchList).items).toStrictEqual([]);
  });

  it('refuses a name I already use, in any case; another person may use it', async () => {
    await create('Robotics');
    const again = await create('ROBOTICS');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SAVED_SEARCH_NAME_TAKEN');
    expect((await create('Robotics', h.bob)).status).toBe(201);
  });

  it('refuses a query key EventQuery does not know', async () => {
    const response = await call(server, 'POST', '/api/v1/saved-searches', {
      as: h.alice,
      body: { name: 'Odd', query: { nearMe: true } },
    });
    expect(response.status).toBe(400);
  });
});

describe('/me/interests', () => {
  it('adds and removes a category, and the view names it', async () => {
    const added = await call(server, 'POST', `/api/v1/me/interests/categories/${categoryId}`, {
      as: h.alice,
    });
    expect(added.status).toBe(200);
    const view = added.body as unknown as MyInterestsView;
    expect(view.categoryIds).toStrictEqual([categoryId]);
    expect(view.categoryOptions).toContainEqual({ id: categoryId, name: 'AI/ML' });
    const bob = await call(server, 'GET', '/api/v1/me/interests', { as: h.bob });
    expect((bob.body as unknown as MyInterestsView).categoryIds).toStrictEqual([]);
    const removed = await call(server, 'DELETE', `/api/v1/me/interests/categories/${categoryId}`, {
      as: h.alice,
    });
    expect((removed.body as unknown as MyInterestsView).categoryIds).toStrictEqual([]);
  });

  it('PUTs the whole set with a typed-in tag; an unknown category is 404', async () => {
    const put = await call(server, 'PUT', '/api/v1/me/interests', {
      as: h.alice,
      body: { categoryIds: [categoryId], tagIds: [], newTagNames: ['Rust'] },
    });
    expect(put.status).toBe(200);
    expect((put.body as unknown as MyInterestsView).tags.map((tag) => tag.name)).toStrictEqual([
      'Rust',
    ]);
    const options = await call(server, 'GET', '/api/v1/me/interests/tag-options?text=ru', {
      as: h.alice,
    });
    expect(options.body).toMatchObject({ tags: [{ name: 'Rust' }] });
    const unknown = await call(server, 'POST', `/api/v1/me/interests/categories/${uuid7()}`, {
      as: h.alice,
    });
    expect(unknown.status).toBe(404);
  });
});
