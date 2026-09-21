import { auditLog } from '../../db/schema/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadScenario, openEventsHarness, type EventsHarness } from '../../testing/events.js';
import type { Principal } from '../auth/types.js';
import type { EventCategoriesService } from './categories.js';

/**
 * The per-event category override (D-15, §10.2 "✓ audited").
 *
 * The rule this file exists for is the second half of D-15: **manual beats
 * rules**, and keeps beating them after the rules change. WP-15b re-classifies
 * every event whenever an administrator edits a rule, so the test that matters
 * is the one that suppresses a category, re-classifies, and finds it still gone.
 */

let h: EventsHarness;
let professor: Principal;
let service: EventCategoriesService;

beforeEach(() => {
  h = openEventsHarness('2026-09-01T00:00:00.000Z', { categories: true });
  professor = h.user('PROFESSOR');
  service = h.module.categoryOverrides!;
});

afterEach(() => {
  h.close();
});

function seedEvent(): { id: string; version: number } {
  const [record] = h.ingestScenario(loadScenario('three-sources-disagree', 'conflicts'));
  const event = h.eventOf(record!);
  return { id: event.id, version: event.version };
}

function categoryId(slug: string): string {
  const category = h.categories!.repo.list().find((candidate) => candidate.slug === slug);
  if (category === undefined) {
    throw new Error(`the seed has no category "${slug}"`);
  }
  return category.id;
}

function slugsOf(eventId: string): { carried: string[]; suppressed: string[] } {
  const rows = h.module.detailRepo.categoriesOf(eventId);
  return {
    carried: rows.filter((row) => !row.isSuppressed).map((row) => row.slug),
    suppressed: rows.filter((row) => row.isSuppressed).map((row) => row.slug),
  };
}

/** The rule engine's own answer for this event, before anyone overrides it. */
function ruleSlugs(eventId: string): string[] {
  return slugsOf(eventId).carried;
}

describe('PUT /events/:id/categories', () => {
  it('adds a category as a MANUAL row and bumps the version', () => {
    const event = seedEvent();
    const web = categoryId('web');
    const result = service.set({ actor: professor }, event.id, {
      categoryIds: [...ruleSlugs(event.id).map(categoryId), web],
      version: event.version,
    });
    expect(result.version).toBe(event.version + 1);
    expect(result.categories.find((category) => category.slug === 'web')).toMatchObject({
      origin: 'MANUAL',
      isSuppressed: false,
    });
  });

  it('removes a rule-assigned category by suppressing it', () => {
    const event = seedEvent();
    expect(slugsOf(event.id).carried).toContain('ai-ml');
    service.set({ actor: professor }, event.id, { categoryIds: [], version: event.version });
    const after = slugsOf(event.id);
    expect(after.carried).not.toContain('ai-ml');
    expect(after.suppressed).toContain('ai-ml');
  });

  it('writes exactly one audit row, naming what changed and nothing else', () => {
    const event = seedEvent();
    const before = h.database.db.drizzle.select().from(auditLog).all().length;
    service.set({ actor: professor }, event.id, {
      categoryIds: [categoryId('web')],
      version: event.version,
    });
    const rows = h.database.db.drizzle.select().from(auditLog).all();
    expect(rows).toHaveLength(before + 1);
    const row = rows[rows.length - 1]!;
    expect(row.action).toBe('event.categorized');
    expect(row.entityId).toBe(event.id);
    expect(row.actorUserId).toBe(professor.id);
    const diff = JSON.parse(row.diffJson) as { added: string[]; removed: string[] };
    expect(diff.added).toEqual([categoryId('web')]);
    expect(diff.removed).toEqual([categoryId('ai-ml')]);
  });

  it('survives a rule edit and a full re-classification (D-15)', async () => {
    const event = seedEvent();
    service.set({ actor: professor }, event.id, { categoryIds: [], version: event.version });
    expect(slugsOf(event.id).suppressed).toContain('ai-ml');

    // Exactly what WP-15b does after an administrator edits a rule.
    h.categories!.classifier.requestReclassification('test: a rule was edited', null);
    const progress = await h.categories!.classifier.processPending();
    expect(progress.finished).toBe(true);

    const after = slugsOf(event.id);
    expect(after.carried).not.toContain('ai-ml');
    expect(after.suppressed).toContain('ai-ml');
  });

  it('clears the suppression when the category is added back', () => {
    const event = seedEvent();
    const first = service.set({ actor: professor }, event.id, {
      categoryIds: [],
      version: event.version,
    });
    const second = service.set({ actor: professor }, event.id, {
      categoryIds: [categoryId('ai-ml')],
      version: first.version,
    });
    expect(second.categories.find((category) => category.slug === 'ai-ml')).toMatchObject({
      origin: 'MANUAL',
      isSuppressed: false,
    });
    expect(slugsOf(event.id).suppressed).toEqual([]);
  });

  it('refuses a stale version with a 409 and writes nothing', () => {
    const event = seedEvent();
    service.set({ actor: professor }, event.id, {
      categoryIds: [categoryId('web')],
      version: event.version,
    });
    const before = slugsOf(event.id);
    expect(() =>
      service.set({ actor: professor }, event.id, {
        categoryIds: [categoryId('mobile')],
        version: event.version,
      }),
    ).toThrow(/version/i);
    expect(slugsOf(event.id)).toEqual(before);
  });

  it('refuses a category that does not exist', () => {
    const event = seedEvent();
    expect(() =>
      service.set({ actor: professor }, event.id, {
        categoryIds: ['0192a000-0000-7000-8000-00000000dead'],
        version: event.version,
      }),
    ).toThrow(/no longer exists|no active category/i);
  });

  it('is a no-op — no audit row, no version bump — when nothing changed', () => {
    const event = seedEvent();
    const before = h.database.db.drizzle.select().from(auditLog).all().length;
    const result = service.set({ actor: professor }, event.id, {
      categoryIds: ruleSlugs(event.id).map(categoryId),
      version: event.version,
    });
    expect(result.version).toBe(event.version);
    expect(h.database.db.drizzle.select().from(auditLog).all()).toHaveLength(before);
  });
});
