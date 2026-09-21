import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REDACTED, hasContactDetails } from '../../domain/normalize/index.js';
import { runScrape } from '../../scraping/run.js';
import {
  asResponse,
  clistTransport,
  openClistHarness,
  type ClistHarness,
} from '../../testing/clist.js';
import { expectGolden } from '../../testing/golden.js';

/**
 * The §19 acceptance criterion of WP-11: recurring rounds leave the main feed
 * and appear in the Contest Calendar; one-offs and yearly editions stay in the
 * feed. End to end: CLIST fixture → adapter → orchestrator → linker → series.
 */

let h: ClistHarness;

beforeEach(() => {
  h = openClistHarness();
});

afterEach(() => {
  h.close();
});

async function ingest(fixture: string): Promise<void> {
  // listing-page1 declares total_count 3, so its second page is served too.
  const pages =
    fixture === 'listing-page1.json'
      ? { 0: asResponse(fixture), 2: asResponse('listing-page2.json') }
      : { 0: asResponse(fixture) };
  const row = await runScrape(h.deps(clistTransport(h.clock, pages)), {
    source: h.source,
    adapter: h.adapter,
    trigger: 'MANUAL',
  });
  expect(row.outcome).toBe('SUCCESS');
}

const titles = (rows: readonly { title: string }[]): string[] =>
  rows.map((row) => row.title).sort();

describe('listing-recurring', () => {
  it('one event_series per family, with the right recurrence', async () => {
    await ingest('listing-recurring.json');
    const series = h.events.series
      .all()
      .map((row) => [row.seriesKey, row.recurrence, row.isRatedContest])
      .sort();
    expect(series).toEqual([
      ['atcoder beginner contest', 'IRREGULAR', true],
      ['codeforces round div', 'IRREGULAR', true],
      ['weekly contest', 'BIWEEKLY', true],
    ]);
  });

  it('every round is is_recurring_round, absent from the main feed and present in the Contest Calendar', async () => {
    await ingest('listing-recurring.json');
    const events = h.events.events.allEvents();
    expect(events).toHaveLength(5);
    expect(events.every((event) => event.isRecurringRound)).toBe(true);
    expect(events.every((event) => event.seriesId !== null)).toBe(true);
    expect(h.events.events.listMainFeed()).toEqual([]);
    expect(titles(h.events.events.listContestCalendar())).toEqual([
      'AtCoder Beginner Contest 380',
      'Codeforces Round 975 (Div. 2)',
      'Weekly Contest 412',
      'Weekly Contest 413',
      'Weekly Contest 414',
    ]);
  });
});

describe('listing-oneoff', () => {
  it('is not a round and appears in the feed', async () => {
    await ingest('listing-oneoff.json');
    const events = h.events.events.allEvents();
    expect(events.every((event) => !event.isRecurringRound)).toBe(true);
    expect(titles(h.events.events.listMainFeed())).toEqual([
      'CodeSprint 48-Hour Hackathon',
      'ICPC Asia West Continent Regional Contest',
    ]);
    expect(h.events.events.listContestCalendar()).toEqual([]);
  });
});

describe('listing-yearly', () => {
  it('is YEARLY, not a round, and in the feed', async () => {
    await ingest('listing-yearly.json');
    const [series] = h.events.series.all();
    expect(series).toMatchObject({
      seriesKey: 'hackindia code challenge',
      recurrence: 'YEARLY',
      isRatedContest: false,
    });
    const [event] = h.events.events.allEvents();
    expect(event).toMatchObject({
      isRecurringRound: false,
      seriesId: series!.id,
      editionYear: 2026,
    });
    expect(titles(h.events.events.listMainFeed())).toEqual(['HackIndia Code Challenge 2026']);
  });
});

describe('normalization', () => {
  it.each(['listing-recurring', 'listing-oneoff', 'listing-yearly', 'listing-page1'])(
    '%s matches its golden',
    async (fixture) => {
      await ingest(`${fixture}.json`);
      const candidates = h.records
        .list(h.source.id)
        .map((record) => JSON.parse(record.payloadJson) as Record<string, unknown>);
      expectGolden(`clist/${fixture}.candidates`, candidates);
    },
  );

  it('fee and team size are unknown (never 0), and no people-shaped key or contact survives (D-29)', async () => {
    for (const fixture of ['listing-recurring', 'listing-oneoff', 'listing-yearly']) {
      await ingest(`${fixture}.json`);
    }
    for (const record of h.records.list(h.source.id)) {
      const candidate = JSON.parse(record.payloadJson) as Record<string, unknown>;
      expect(candidate.fee).toEqual({ known: false, confidence: 0 });
      expect(candidate.teamSize).toBeUndefined();
      const text = record.payloadJson;
      for (const key of [
        'participants',
        'judges',
        'mentors',
        'contacts',
        'phone',
        'contactEmail',
      ]) {
        expect(text).not.toContain(`"${key}"`);
      }
      const strings = Object.values(candidate).filter(
        (value): value is string => typeof value === 'string',
      );
      expect(hasContactDetails(strings.join('\n'))).toBe(false);
      expect(text).not.toContain(REDACTED);
    }
  });
});
