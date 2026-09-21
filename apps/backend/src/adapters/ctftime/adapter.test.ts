import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SourceRow } from '../../db/schema/index.js';
import { fixedClock } from '../../platform/time.js';
import { sourceRequestContext } from '../../scraping/source-row.js';
import {
  CTFTIME_CAPTURE_CLOCK,
  ctftimeFixture,
  ctftimeFixtureBytes,
  HAND_WRITTEN_CTFTIME_FIXTURES,
  RECORDED_CTFTIME_FIXTURES,
} from '../../testing/ctftime.js';
import {
  CTFTIME_ORIGIN,
  CTFTIME_ROBOTS_URL,
  openCtftimeRun,
  recordedCtftimeRobots,
  type CtftimeRunHarness,
} from '../../testing/ctftime-run.js';
import { fakeTransport, silentLogger, type FakeResponse } from '../../testing/scraping.js';
import type { AdapterContext, ListingItem, ListingResult } from '../../sources/types.js';
import { LISTING_WINDOW_DAYS } from './adapter.js';
import { apiOrigin, detailUrl, listingUrl, parseEventId } from './paths.js';

/**
 * The adapter's own mechanics: the two URL builders, the listing walk's
 * narrowing and its honesty about completeness (A8), the detail step, and R62's
 * pinned fixtures.
 */

describe('R62: the recorded payloads are pinned', () => {
  const research = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'docs',
    'research',
    'fixtures',
    'ctftime',
  );

  it.each(RECORDED_CTFTIME_FIXTURES)('%s is byte-identical to docs/research', (name) => {
    expect(ctftimeFixtureBytes(name).equals(readFileSync(path.join(research, name)))).toBe(true);
  });

  it.each(HAND_WRITTEN_CTFTIME_FIXTURES)('%s says it was written by hand', (name) => {
    expect(ctftimeFixtureBytes(name).toString('utf8')).toContain('HAND-WRITTEN FIXTURE (WP-09b)');
  });
});

describe('paths: two URLs, built from numbers', () => {
  it('builds the listing with the limit capped at 100', () => {
    expect(listingUrl(CTFTIME_ORIGIN, { startSec: 10, finishSec: 20 }, 500)).toBe(
      'https://ctftime.org/api/v1/events/?limit=100&start=10&finish=20',
    );
  });

  it('builds the detail from a numeric id only', () => {
    expect(detailUrl(CTFTIME_ORIGIN, 3417)).toBe('https://ctftime.org/api/v1/events/3417/');
    expect(detailUrl(CTFTIME_ORIGIN, '3417')).toBe('https://ctftime.org/api/v1/events/3417/');
    for (const bad of ['../export', '3417/extra', '3417?x=1', '', '0', '-1', 'abc', 1.5, null]) {
      expect(parseEventId(bad), String(bad)).toBeUndefined();
      expect(() => detailUrl(CTFTIME_ORIGIN, bad), String(bad)).toThrow(TypeError);
    }
  });

  it('accepts only an https origin as the base', () => {
    expect(apiOrigin('https://ctftime.org')).toBe('https://ctftime.org');
    expect(() => apiOrigin('http://ctftime.org')).toThrow(TypeError);
    expect(() => apiOrigin('https://ctftime.org/api/')).toThrow(TypeError);
  });
});

describe('the listing walk', () => {
  const clock = CTFTIME_CAPTURE_CLOCK;
  const startSec = Math.floor(clock.now().getTime() / 1000);
  const finishSec = startSec + LISTING_WINDOW_DAYS * 86_400;
  let h: CtftimeRunHarness;

  beforeEach(() => {
    h = openCtftimeRun(clock);
  });

  afterEach(() => {
    h.close();
  });

  /** A page of `count` events starting one hour apart from `firstStartSec`. */
  function page(firstId: number, count: number, firstStartSec: number): FakeResponse {
    const template = (ctftimeFixture('listing-events.json') as Record<string, unknown>[])[4]!;
    const events = Array.from({ length: count }, (_, index) => ({
      ...template,
      id: firstId + index,
      start: new Date((firstStartSec + index * 3600) * 1000).toISOString(),
      finish: new Date((firstStartSec + index * 3600 + 7200) * 1000).toISOString(),
    }));
    return { body: JSON.stringify(events) };
  }

  function contextFor(source: SourceRow, routes: Record<string, FakeResponse>, limit = 100) {
    const transport = fakeTransport({
      [CTFTIME_ROBOTS_URL]: { body: recordedCtftimeRobots() },
      ...routes,
    });
    const http = h
      .deps(transport)
      .http.clientFor(sourceRequestContext(source), new AbortController().signal);
    const context: AdapterContext = {
      http,
      log: silentLogger,
      clock,
      now: () => clock.now(),
      signal: new AbortController().signal,
      config: { listingLimit: limit },
    };
    return { transport, context };
  }

  async function drain(
    context: AdapterContext,
  ): Promise<{ items: ListingItem[]; result: ListingResult | void }> {
    const walk = h.adapter.listing(context);
    const items: ListingItem[] = [];
    for (;;) {
      const next = await walk.next();
      if (next.done === true) {
        return { items, result: next.value };
      }
      items.push(next.value);
    }
  }

  it('narrows the window from the latest start when a page comes back full', async () => {
    const secondStart = startSec + 2 * 3600;
    const { transport, context } = contextFor(
      h.source,
      {
        [listingUrl(CTFTIME_ORIGIN, { startSec, finishSec }, 3)]: page(1, 3, startSec),
        // The overlap at the boundary is expected and deduplicated by id.
        [listingUrl(CTFTIME_ORIGIN, { startSec: secondStart, finishSec }, 3)]: page(
          3,
          2,
          secondStart,
        ),
      },
      3,
    );
    const { items, result } = await drain(context);
    expect(items.map((item) => item.externalKey)).toEqual(['1', '2', '3', '4']);
    expect(result).toEqual({ complete: true });
    expect(transport.calls.filter((call) => call.url !== CTFTIME_ROBOTS_URL)).toHaveLength(2);
  });

  it('reports incomplete when the request cap ends the walk (A8)', async () => {
    const source = { ...h.source, maxRequestsPerRun: 1 };
    const { context } = contextFor(
      source,
      { [listingUrl(CTFTIME_ORIGIN, { startSec, finishSec }, 3)]: page(1, 3, startSec) },
      3,
    );
    const { items, result } = await drain(context);
    expect(items).toHaveLength(3);
    expect(result).toEqual({ complete: false });
  });

  it('reports incomplete when a full page is not in start order', async () => {
    const shuffled = JSON.parse(page(1, 3, startSec).body as string) as unknown[];
    shuffled.reverse();
    const { context } = contextFor(
      h.source,
      {
        [listingUrl(CTFTIME_ORIGIN, { startSec, finishSec }, 3)]: {
          body: JSON.stringify(shuffled),
        },
      },
      3,
    );
    expect((await drain(context)).result).toEqual({ complete: false });
  });

  it('yields each event with its numeric id and a snapshot of its own object', async () => {
    const { context } = contextFor(h.source, {
      [listingUrl(CTFTIME_ORIGIN, { startSec, finishSec }, 100)]: {
        body: JSON.stringify(ctftimeFixture('listing-events.json')),
      },
    });
    const { items } = await drain(context);
    expect(items.map((item) => item.externalKey)).toEqual(['3435', '3422', '3374', '3093', '3312']);
    const first = items[0]!;
    expect(first.url).toBe('https://ctftime.org/event/3435/');
    expect(JSON.parse(new TextDecoder().decode(first.raw))).toMatchObject({
      id: 3435,
      participants: 32,
    });
  });
});

describe('the detail step', () => {
  let h: CtftimeRunHarness;

  beforeEach(() => {
    h = openCtftimeRun(fixedClock('2026-09-20T00:00:00.000Z'));
  });

  afterEach(() => {
    h.close();
  });

  it('a non-numeric id makes no request and normalizes to nothing, so the item is invalid', async () => {
    const transport = fakeTransport({ [CTFTIME_ROBOTS_URL]: { body: recordedCtftimeRobots() } });
    const context: AdapterContext = {
      http: h
        .deps(transport)
        .http.clientFor(sourceRequestContext(h.source), new AbortController().signal),
      log: silentLogger,
      clock: CTFTIME_CAPTURE_CLOCK,
      now: () => CTFTIME_CAPTURE_CLOCK.now(),
      signal: new AbortController().signal,
      config: {},
    };
    const item: ListingItem = {
      externalKey: '../export',
      url: 'https://ctftime.org/event/x/',
      payload: {},
    };
    const detail = await h.adapter.detail!(context, item);
    expect(transport.calls).toHaveLength(0);
    expect(() =>
      h.adapter.normalize(detail, {
        clock: CTFTIME_CAPTURE_CLOCK,
        sourceKey: 'ctftime',
        defaultTimeZone: 'Asia/Kolkata',
      }),
    ).toThrow(TypeError);
  });
});
