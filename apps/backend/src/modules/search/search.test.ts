import { SearchResponse } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../platform/errors.js';
import { openSearchHarness, type SearchHarness } from '../../testing/search.js';
import type { Principal } from '../auth/types.js';

/**
 * Text search, aliases, pagination and the detail read, end to end over the
 * real migrations (§8.2, WP-15a steps 4–7).
 */

let h: SearchHarness;
const NOW = Date.parse('2026-09-22T06:30:00.000Z');
const DAY = 86_400_000;

beforeEach(() => {
  h = openSearchHarness();
});

afterEach(() => {
  h.close();
});

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR';
  }
  return undefined;
}

describe('text: bm25 weights and escaping', () => {
  it('a title match outranks an organizer match, which outranks a description match', () => {
    h.add({ title: 'Quantum Night', descriptionMd: 'nothing' });
    h.add({ title: 'Plain Event', organizerName: 'Quantum Society' });
    h.add({ title: 'Another Event', descriptionMd: 'a talk on quantum computing' });
    expect(h.titles({ text: 'quantum' })).toEqual([
      'Quantum Night',
      'Plain Event',
      'Another Event',
    ]);
  });

  it('porter stemming: "hackathons" finds "Hackathon"', () => {
    h.add({ title: 'Winter Hackathon' });
    expect(h.titles({ text: 'hackathons' })).toEqual(['Winter Hackathon']);
  });

  it('several words are AND-ed', () => {
    h.add({ title: 'Winter Hackathon', organizerName: 'IIT Madras' });
    h.add({ title: 'Summer Hackathon', organizerName: 'IIT Bombay' });
    expect(h.titles({ text: 'hackathon madras' })).toEqual(['Winter Hackathon']);
  });

  it.each([
    ['a lone quote', '"'],
    ['a star', '*'],
    ['NEAR(', 'NEAR('],
    ['OR', 'OR'],
    ['an unbalanced quote', 'hack"athon'],
    ['operators together', 'hack* OR NOT "x" NEAR(a b) ^title: -'],
    ['200 characters', `${'x'.repeat(50)} OR ${'near( '.repeat(24)}`.slice(0, 200)],
  ])('%s is searched literally and never errors', (_name, text) => {
    h.add({ title: 'Winter Hackathon', organizerName: 'OR Society' });
    const response = h.query({ text });
    expect(SearchResponse.safeParse(response).success).toBe(true);
  });

  it('"OR" is a literal word, not an operator', () => {
    h.add({ title: 'Winter Hackathon', organizerName: 'OR Society' });
    h.add({ title: 'Robotics League' });
    expect(h.titles({ text: 'OR' })).toEqual(['Winter Hackathon']);
  });

  it('text over 200 characters is SEARCH_TEXT_TOO_LONG; a bad shape SEARCH_INVALID_QUERY', () => {
    expect(codeOf(() => h.query({ text: 'x'.repeat(201) }))).toBe('SEARCH_TEXT_TOO_LONG');
    expect(codeOf(() => h.search.service.search({ actor: h.user() }, { sort: 'POPULAR' }))).toBe(
      'SEARCH_INVALID_QUERY',
    );
    expect(codeOf(() => h.search.service.search({ actor: h.user() }, { nope: 1 }))).toBe(
      'SEARCH_INVALID_QUERY',
    );
  });
});

describe('aliases', () => {
  let admin: Principal;

  beforeEach(() => {
    admin = h.user('ADMINISTRATOR');
    h.add({ title: 'Machine Learning Challenge' });
    h.add({ title: 'ML Hackathon' });
    h.add({ title: 'Capture The Flag Qualifier', eventType: 'CTF' });
    h.add({ title: 'Robotics League' });
  });

  it('"ML" finds "machine learning" events and vice versa', () => {
    expect(h.titles({ text: 'ml' }).sort()).toEqual(['ML Hackathon', 'Machine Learning Challenge']);
    expect(h.titles({ text: 'machine learning' }).sort()).toEqual([
      'ML Hackathon',
      'Machine Learning Challenge',
    ]);
    expect(h.titles({ text: 'CTF' })).toEqual(['Capture The Flag Qualifier']);
  });

  it('deleting the alias reverses it', () => {
    h.search.aliases.delete({ actor: admin }, 'ML');
    expect(h.titles({ text: 'ml' })).toEqual(['ML Hackathon']);
    expect(h.titles({ text: 'machine learning' })).toEqual(['Machine Learning Challenge']);
  });

  it('a new alias works immediately; a duplicate term is SEARCH_ALIAS_EXISTS', () => {
    expect(h.titles({ text: 'bots' })).toEqual([]);
    h.search.aliases.put({ actor: admin }, 'Bots', { expansions: ['robotics'] });
    expect(h.titles({ text: 'bots' })).toEqual(['Robotics League']);
    expect(
      codeOf(() => h.search.aliases.put({ actor: admin }, 'bots', { expansions: ['x'] })),
    ).toBe('SEARCH_ALIAS_EXISTS');
    h.search.aliases.put({ actor: admin }, 'bots', { expansions: ['league'], replace: true });
    expect(h.search.aliases.list().find((alias) => alias.term === 'bots')?.expansions).toEqual([
      'league',
    ]);
  });

  it('only administrators may edit, and every write is audited', () => {
    const professor = h.user('PROFESSOR');
    expect(
      codeOf(() => h.search.aliases.put({ actor: professor }, 'x', { expansions: ['y'] })),
    ).toBe('FORBIDDEN');
    expect(codeOf(() => h.search.aliases.delete({ actor: professor }, 'ml'))).toBe('FORBIDDEN');
    h.search.aliases.put({ actor: admin }, 'iot', { expansions: ['internet of things'] });
    h.search.aliases.delete({ actor: admin }, 'iot');
    const actions = h.database.db.raw
      .prepare(
        `SELECT action FROM audit_log WHERE entity_kind = 'search_alias' ORDER BY occurred_at`,
      )
      .all() as { action: string }[];
    expect(actions.map((row) => row.action)).toEqual([
      'search.alias.created',
      'search.alias.deleted',
    ]);
  });
});

describe('keyset pagination', () => {
  function pageThrough(query: Record<string, unknown>, limit: number): string[] {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const response = h.query({ ...query, limit, ...(cursor === undefined ? {} : { cursor }) });
      seen.push(...response.items.map((item) => item.id));
      cursor = response.nextCursor;
      if (cursor === undefined) break;
    }
    return seen;
  }

  beforeEach(() => {
    for (let index = 0; index < 23; index += 1) {
      h.add({
        title: `Hackathon ${String(index)}`,
        // Duplicate sort keys and NULLs on purpose: the id tie-break must hold.
        registrationDeadlineAt: index % 4 === 0 ? null : NOW + (index % 5) * DAY,
        startsAt: index % 3 === 0 ? null : NOW + (index % 7) * DAY,
        prizeTotalMinor: index % 2 === 0 ? null : (index % 3) * 1000,
        prizeCurrency: index % 2 === 0 ? null : 'INR',
        firstSeenAt: NOW - (index % 6) * DAY,
      });
    }
  });

  it.each(['RELEVANCE', 'DEADLINE', 'START', 'PRIZE', 'NEWEST'] as const)(
    '%s: every row exactly once, with and without text',
    (sort) => {
      for (const text of [undefined, 'hackathon']) {
        const ids = pageThrough({ sort, ...(text === undefined ? {} : { text }) }, 5);
        expect(ids).toHaveLength(23);
        expect(new Set(ids).size).toBe(23);
      }
    },
  );

  it('stays stable when rows are inserted mid-scroll', () => {
    const first = h.query({ sort: 'DEADLINE', limit: 10 });
    // A new event that sorts *before* the cursor must not shift the next page.
    h.add({ title: 'Hackathon early', registrationDeadlineAt: NOW });
    const second = h.query({ sort: 'DEADLINE', limit: 10, cursor: first.nextCursor });
    const all = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(all).size).toBe(20);
    expect(second.items.map((item) => item.title)).not.toContain('Hackathon early');
  });

  it('a tampered, truncated or foreign cursor is SEARCH_INVALID_CURSOR', () => {
    const cursor = h.query({ sort: 'DEADLINE', limit: 5 }).nextCursor ?? '';
    const [body = '', signature = ''] = cursor.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), i: 'zzz' }),
    ).toString('base64url');
    for (const bad of [`${forged}.${signature}`, cursor.slice(0, -3), 'garbage', `${cursor}.x`]) {
      expect(codeOf(() => h.query({ sort: 'DEADLINE', limit: 5, cursor: bad }))).toBe(
        'SEARCH_INVALID_CURSOR',
      );
    }
    // Same cursor, different query: refused, never silently applied.
    expect(codeOf(() => h.query({ sort: 'DEADLINE', limit: 5, text: 'x', cursor }))).toBe(
      'SEARCH_INVALID_CURSOR',
    );
    expect(codeOf(() => h.query({ sort: 'START', limit: 5, cursor }))).toBe(
      'SEARCH_INVALID_CURSOR',
    );
  });

  it('reports the total across pages, and no cursor on the last page', () => {
    const first = h.query({ limit: 20 });
    expect(first.total).toBe(23);
    expect(first.totalIsApproximate).toBe(false);
    const last = h.query({ limit: 20, cursor: first.nextCursor });
    expect(last.items).toHaveLength(3);
    expect(last.total).toBe(23);
    expect(last.nextCursor).toBeUndefined();
  });
});

describe('GET /events/:id core read', () => {
  it('returns the core event with deadlines, sources and distance', () => {
    h.campus(10.7905, 78.7047);
    const id = h.add({
      title: 'Detail Hackathon',
      mode: 'OFFLINE',
      lat: 13.0827,
      lon: 80.2707,
      geoPrecision: 'CITY',
      registrationUrl: 'https://example.org/register',
    });
    h.addSource(id, 'devfolio');
    const core = h.search.service.detail({ actor: h.user() }, id);
    expect(core).toMatchObject({ id, title: 'Detail Hackathon', categories: [], deadlines: [] });
    expect(core.sources.map((source) => source.key)).toEqual(['devfolio']);
    expect(core.distanceKm).toBeGreaterThan(280);
  });

  it('a hidden, merged or missing event is EVENT_NOT_FOUND', () => {
    const survivor = h.add({ title: 'Survivor' });
    const hidden = h.add({ title: 'Hidden', visibility: 'ADMIN_HIDDEN' });
    const merged = h.add({ title: 'Merged', visibility: 'MERGED', mergedIntoEventId: survivor });
    for (const id of [hidden, merged, '01920000-0000-7000-8000-00000000dead']) {
      expect(codeOf(() => h.search.service.detail({ actor: h.user() }, id))).toBe(
        'EVENT_NOT_FOUND',
      );
    }
  });
});
