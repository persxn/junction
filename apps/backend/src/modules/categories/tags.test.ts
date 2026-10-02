import { readFileSync } from 'node:fs';
import path from 'node:path';

import { EventCandidate } from '@compintel/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { openEventsHarness, type EventsHarness } from '../../testing/events.js';
import { openSearchHarness, type SearchHarness } from '../../testing/search.js';
import { deriveTags, TECHNOLOGY_TAGS } from './domain/tags.js';

/**
 * Ruling R87: event tags come from source tags.
 *
 * Before it, `event_tags` had no writer, so the tags filter, the FTS `tags`
 * column and the tag-interest boost were all inert. These tests run the real
 * adapters' recorded output through the real link path and then ask search.
 */

const FIXTURES = path.resolve(import.meta.dirname, '../../../test/fixtures');

function goldenCandidates(file: string): EventCandidate[] {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')) as unknown[];
  return raw.map((entry) => EventCandidate.parse(entry));
}

let events: EventsHarness | undefined;
let search: SearchHarness | undefined;

afterEach(() => {
  events?.close();
  events = undefined;
  search?.close();
  search = undefined;
});

function tagsOf(harness: EventsHarness, eventId: string): { name: string; kind: string }[] {
  return harness.database.db.raw
    .prepare(
      `SELECT t.name, t.kind, et.origin FROM event_tags et JOIN tags t ON t.id = et.tag_id
       WHERE et.event_id = ? ORDER BY t.normalized`,
    )
    .all(eventId) as { name: string; kind: string; origin: string }[];
}

describe('deriveTags — the seeded map', () => {
  it('names a technology TECHNOLOGY and everything else THEME', () => {
    expect(deriveTags(['Blockchain', 'AI/ML', 'Social Good', 'Jeopardy'])).toEqual([
      { name: 'Blockchain', normalized: 'blockchain', kind: 'TECHNOLOGY' },
      { name: 'AI/ML', normalized: 'ai/ml', kind: 'TECHNOLOGY' },
      { name: 'Social Good', normalized: 'social good', kind: 'THEME' },
      { name: 'Jeopardy', normalized: 'jeopardy', kind: 'THEME' },
    ]);
  });

  it('folds case and spacing into one tag, and drops blanks and sentences', () => {
    const derived = deriveTags(['  Web3 ', 'WEB3', '', 'x'.repeat(41), 'Open   Innovation']);
    expect(derived.map((tag) => tag.name)).toEqual(['Web3', 'Open Innovation']);
  });

  it('keeps the map small and lower-case', () => {
    expect(TECHNOLOGY_TAGS.size).toBeLessThan(60);
    for (const tag of TECHNOLOGY_TAGS) expect(tag).toBe(tag.toLowerCase().trim());
  });
});

describe('the linker writes event_tags (origin SOURCE_TAG)', () => {
  it('from a Devfolio and a CTFtime fixture, through the real link path', () => {
    events = openEventsHarness('2026-09-21T00:00:00.000Z', { categories: true });
    const [devfolio] = goldenCandidates('devfolio/listing.candidates.golden.json');
    const ctftime = goldenCandidates('ctftime/listing-events.candidates.golden.json');
    const df = events.eventOf(events.ingest('devfolio', devfolio!));
    const jeopardy = events.eventOf(events.ingest('ctftime', ctftime[0]!));
    const attack = events.eventOf(events.ingest('ctftime', ctftime[4]!));

    expect(tagsOf(events, df.id)).toEqual([
      { name: 'No Restrictions', kind: 'THEME', origin: 'SOURCE_TAG' },
    ]);
    expect(tagsOf(events, jeopardy.id)).toEqual([
      { name: 'Jeopardy', kind: 'THEME', origin: 'SOURCE_TAG' },
    ]);
    expect(tagsOf(events, attack.id)).toEqual([
      { name: 'Attack-Defense', kind: 'THEME', origin: 'SOURCE_TAG' },
    ]);
    // One `tags` row per word, shared by every event that carries it.
    const rows = events.database.db.raw
      .prepare(`SELECT count(*) AS n FROM tags WHERE normalized = 'jeopardy'`)
      .get() as { n: number };
    expect(rows.n).toBe(1);
    // The FTS column's source text moves with them.
    expect(events.eventOf(events.record('ctftime', ctftime[0]!.externalKey)).tagsText).toBe(
      'Jeopardy',
    );
  });

  it('a re-scrape that drops a tag drops its row', () => {
    events = openEventsHarness('2026-09-21T00:00:00.000Z', { categories: true });
    const [first] = goldenCandidates('ctftime/listing-events.candidates.golden.json');
    const event = events.eventOf(events.ingest('ctftime', first!));
    events.ingest('ctftime', { ...first!, sourceTags: ['Attack-Defense'] });
    expect(tagsOf(events, event.id).map((tag) => tag.name)).toEqual(['Attack-Defense']);
  });
});

describe('search reads them', () => {
  async function tagged(): Promise<SearchHarness> {
    const h = openSearchHarness();
    h.seedCategories();
    const ctf = h.add({ title: 'Winter CTF', eventType: 'CTF' });
    h.addSource(ctf, 'ctftime', ['Jeopardy']);
    const hack = h.add({ title: 'Ledger Hack' });
    h.addSource(hack, 'devfolio', ['Blockchain', 'Quantum Widgets']);
    h.add({ title: 'Untagged Meetup' });
    await h.classifyAll();
    return h;
  }

  it('the tags filter finds them', async () => {
    search = await tagged();
    expect(search.titles({ tags: ['jeopardy'] })).toEqual(['Winter CTF']);
    expect(search.titles({ tags: ['Blockchain'] })).toEqual(['Ledger Hack']);
  });

  it('the FTS tags column finds a word that is only a tag', async () => {
    search = await tagged();
    expect(search.titles({ text: 'quantum widgets' })).toEqual(['Ledger Hack']);
  });

  it('the tag-interest boost fires, in the professor’s own spelling', async () => {
    search = await tagged();
    const professor = search.user('PROFESSOR');
    search.interest(professor, 'blockchain');
    const response = search.query({ sort: 'RELEVANCE' }, professor);
    const card = response.items.find((item) => item.title === 'Ledger Hack') as
      { reasons?: { code: string; text: string }[] } | undefined;
    expect(card?.reasons?.map((reason) => reason.code)).toContain('TAG_MATCH');
    const other = response.items.find((item) => item.title === 'Winter CTF') as
      { reasons?: { code: string }[] } | undefined;
    expect(other?.reasons?.map((reason) => reason.code)).not.toContain('TAG_MATCH');
  });
});
