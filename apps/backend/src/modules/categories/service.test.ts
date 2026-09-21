import { afterEach, describe, expect, it } from 'vitest';

import { openEventsHarness, toCandidate, type EventsHarness } from '../../testing/events.js';
import { CATEGORY_SEED_FILE, openSearchHarness, type SearchHarness } from '../../testing/search.js';
import { applyCategorySeed, CATEGORY_SEED_META_KEY, loadCategorySeed } from './seed.js';

/**
 * Applying the rules (WP-15b step 4): seed, classification on ingest, the
 * batched re-classification, and D-15's "manual beats rules, always".
 */

interface Row {
  category: string;
  origin: string;
  suppressed: number;
  confidence: number;
}

let search: SearchHarness | undefined;
let events: EventsHarness | undefined;
afterEach(() => {
  search?.close();
  events?.close();
  search = undefined;
  events = undefined;
});

function rowsOf(h: SearchHarness | EventsHarness, eventId: string): Row[] {
  return h.database.db.raw
    .prepare(
      `SELECT c.slug AS category, ec.origin, ec.is_suppressed AS suppressed, ec.confidence
       FROM event_categories ec JOIN categories c ON c.id = ec.category_id WHERE ec.event_id = ? ORDER BY c.slug`,
    )
    .all(eventId) as Row[];
}

function categoryId(h: SearchHarness, slug: string): string {
  return (
    h.database.db.raw.prepare('SELECT id FROM categories WHERE slug = ?').get(slug) as {
      id: string;
    }
  ).id;
}

describe('the seed', () => {
  it('lands the twelve starter categories once, and a second run changes nothing', () => {
    search = openSearchHarness();
    const seed = loadCategorySeed(CATEGORY_SEED_FILE);
    const first = applyCategorySeed(search.database.db, seed, 1);
    expect(first).toMatchObject({ applied: true, categoriesAdded: 12 });
    expect(first.rulesAdded).toBeGreaterThan(80);
    expect(applyCategorySeed(search.database.db, seed, 2)).toEqual({
      applied: false,
      categoriesAdded: 0,
      rulesAdded: 0,
    });
    const names = search.categories.repo.list().map((category) => category.name);
    expect(names).toEqual([
      'AI/ML',
      'Cybersecurity/CTF',
      'Web',
      'Mobile',
      'Blockchain',
      'Data Science',
      'IoT/Hardware',
      'Robotics',
      'Design',
      'Social Impact',
      'Open Source',
      'Competitive Programming',
    ]);
  });

  it('a version bump adds only what is missing and never overwrites an administrator', () => {
    search = openSearchHarness();
    const seed = loadCategorySeed(CATEGORY_SEED_FILE);
    applyCategorySeed(search.database.db, seed, 1);
    const raw = search.database.db.raw;
    raw
      .prepare("UPDATE categories SET name = 'Artificial Intelligence' WHERE slug = 'ai-ml'")
      .run();
    raw.prepare("DELETE FROM category_rules WHERE pattern = 'llm'").run();
    const bumped = { ...seed, version: seed.version + 1 };
    expect(applyCategorySeed(search.database.db, bumped, 2)).toEqual({
      applied: true,
      categoriesAdded: 0,
      rulesAdded: 1,
    });
    expect(raw.prepare("SELECT name FROM categories WHERE slug = 'ai-ml'").get()).toEqual({
      name: 'Artificial Intelligence',
    });
    expect(
      raw.prepare('SELECT value FROM app_meta WHERE key = ?').get(CATEGORY_SEED_META_KEY),
    ).toEqual({
      value: String(seed.version + 1),
    });
  });
});

describe('classification on ingest', () => {
  it('a scraped record is classified in its own transaction, from its title and its source tags', () => {
    events = openEventsHarness('2026-09-01T00:00:00.000Z', { categories: true });
    const record = events.ingest('devfolio', {
      ...toCandidate('devfolio', 'eth-26', {
        title: 'ETHIndia 2026',
        eventType: 'HACKATHON',
        mode: 'OFFLINE',
      }),
      sourceTags: ['Blockchain', 'AI'],
    });
    const event = events.eventOf(record);
    expect(rowsOf(events, event.id)).toEqual([
      { category: 'ai-ml', origin: 'SOURCE_TAG', suppressed: 0, confidence: 0.8 },
      { category: 'blockchain', origin: 'SOURCE_TAG', suppressed: 0, confidence: 1 },
    ]);
  });

  it('a later scrape that drops a tag drops the category it gave', () => {
    events = openEventsHarness('2026-09-01T00:00:00.000Z', { categories: true });
    const candidate = toCandidate('devfolio', 'x-1', {
      title: 'Unfold 2026',
      eventType: 'HACKATHON',
      mode: 'ONLINE',
    });
    const record = events.ingest('devfolio', { ...candidate, sourceTags: ['Blockchain', 'AI'] });
    events.ingest('devfolio', { ...candidate, sourceTags: ['Blockchain'] });
    expect(rowsOf(events, events.eventOf(record).id).map((row) => row.category)).toEqual([
      'blockchain',
    ]);
  });
});

describe('manual beats rules, always (D-15)', () => {
  async function seeded(): Promise<{ h: SearchHarness; eventId: string }> {
    const h = openSearchHarness();
    search = h;
    h.seedCategories();
    const eventId = h.add({ title: 'AI for Good Hackathon' });
    h.add({ title: 'Robocon India 2026' });
    await h.classifyAll();
    return { h, eventId };
  }

  it('a manual suppression survives a rule edit and a full re-classification', async () => {
    const { h, eventId } = await seeded();
    expect(rowsOf(h, eventId)).toEqual([
      { category: 'ai-ml', origin: 'RULE', suppressed: 0, confidence: 0.7 },
    ]);
    const professor = h.user('PROFESSOR');
    h.categories.repo.setManual(eventId, categoryId(h, 'ai-ml'), true, professor.id, 2);

    // The administrator makes the rule that matched *stronger*, then everything is re-run.
    const admin = h.user('ADMINISTRATOR');
    const rule = h.categories.admin
      .listRules({ actor: admin }, categoryId(h, 'ai-ml'))
      .find((candidate) => candidate.kind === 'KEYWORD' && candidate.pattern === 'ai');
    h.categories.admin.patchRule({ actor: admin }, rule!.id, { weight: 100 });
    const progress = await h.categories.classifier.processPending();
    expect(progress.finished).toBe(true);

    expect(rowsOf(h, eventId)).toEqual([
      { category: 'ai-ml', origin: 'MANUAL', suppressed: 1, confidence: 1 },
    ]);
    // …and the suppressed category does not come back in search either.
    const hit = h.query({ categories: ['ai-ml'] });
    expect(hit.items.map((item) => item.id)).not.toContain(eventId);
  });

  it('a MANUAL assignment is never downgraded to RULE, and one no rule makes is kept', async () => {
    const { h, eventId } = await seeded();
    const professor = h.user('PROFESSOR');
    h.categories.repo.setManual(eventId, categoryId(h, 'ai-ml'), false, professor.id, 2);
    h.categories.repo.setManual(eventId, categoryId(h, 'social-impact'), false, professor.id, 2);
    await h.classifyAll();
    expect(rowsOf(h, eventId)).toEqual([
      { category: 'ai-ml', origin: 'MANUAL', suppressed: 0, confidence: 1 },
      { category: 'social-impact', origin: 'MANUAL', suppressed: 0, confidence: 1 },
    ]);
  });
});

describe('batched re-classification', () => {
  it('works in chunks, commits its position, and resumes where it stopped', async () => {
    const h = openSearchHarness();
    search = h;
    h.seedCategories();
    const ids = [
      'ICPC Asia',
      'Weekend CTF',
      'Hacktoberfest',
      'Datathon',
      'Robocon',
      'Designathon',
      'HackCBS',
    ].map((title) => h.add({ title }));
    const classifier = h.categories.classifier;
    const runId = classifier.requestReclassification('test', null);

    const first = await classifier.processPending({ chunkSize: 2, maxChunks: 2 });
    expect(first).toMatchObject({ runId, events: 4, finished: false });
    const stored = h.database.db.raw
      .prepare(
        'SELECT events_done AS done, finished_at AS finishedAt FROM category_reclassify_runs WHERE id = ?',
      )
      .get(runId);
    expect(stored).toEqual({ done: 4, finishedAt: null });

    // A new process picks the same run up and finishes it.
    const second = await classifier.processPending({ chunkSize: 2 });
    expect(second).toMatchObject({ runId, events: 7, finished: true });
    const classified = ids.filter((id) => rowsOf(h, id).length > 0);
    expect(classified).toHaveLength(6); // HackCBS matches nothing
  });

  it('a newer request supersedes a half-finished run', async () => {
    const h = openSearchHarness();
    search = h;
    h.seedCategories();
    for (const title of ['a', 'b', 'c']) h.add({ title });
    const classifier = h.categories.classifier;
    const old = classifier.requestReclassification('first', null);
    await classifier.processPending({ chunkSize: 1, maxChunks: 1 });
    const newer = classifier.requestReclassification('second', null);
    expect(h.categories.repo.pendingRun()?.id).toBe(newer);
    expect(newer).not.toBe(old);
    expect(await classifier.processPending({ chunkSize: 1 })).toMatchObject({
      runId: newer,
      events: 3,
      finished: true,
    });
  });

  it('stops between chunks when the job is aborted', async () => {
    const h = openSearchHarness();
    search = h;
    for (const title of ['a', 'b', 'c']) h.add({ title });
    const controller = new AbortController();
    controller.abort();
    h.categories.classifier.requestReclassification('x', null);
    expect(
      await h.categories.classifier.processPending({ signal: controller.signal }),
    ).toMatchObject({
      finished: false,
      events: 0,
    });
  });
});
