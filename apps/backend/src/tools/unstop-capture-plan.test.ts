import { describe, expect, it } from 'vitest';

import { isForbidden } from '../adapters/unstop/fetch.js';
import { UnstopListingPage } from '../domain/unstop/schema.js';
import { unstopFixture } from '../testing/unstop.js';
import {
  captureMeta,
  CAPTURE_BUDGET,
  plannedDetail,
  plannedListings,
  r71Verdict,
  scrubFixture,
  type Observation,
} from './unstop-capture-plan.js';

/** `unstop:capture` (WP-13 step 4) planned, scrubbed and judged — offline. */

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    url: 'https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons',
    at: '2026-09-21T10:00:00.000Z',
    status: 200,
    contentType: 'application/json',
    bytes: 2048,
    schemaMatched: true,
    rateLimitHeaders: {},
    ...overrides,
  };
}

describe('the capture plan', () => {
  it('asks for one listing per opportunity type and stays inside four requests', () => {
    const listings = plannedListings();
    expect(listings.map((planned) => planned.name)).toEqual([
      'listing-hackathons-p1',
      'listing-competitions-p1',
    ]);
    expect(listings.length + listings.length).toBeLessThanOrEqual(CAPTURE_BUDGET);
  });

  it('plans only /api/public/ URLs the deny list allows', () => {
    const planned = [...plannedListings(), plannedDetail(1100001)];
    for (const request of planned) {
      expect(new URL(request.url).pathname.startsWith('/api/public/')).toBe(true);
      expect(isForbidden(request.url)).toBe(false);
    }
  });

  it('builds a detail URL from the id alone, never from a payload URL', () => {
    expect(plannedDetail(1200002).url).toBe('https://unstop.com/api/public/competition/1200002');
  });
});

describe('scrubFixture', () => {
  it('nulls people-shaped keys and redacts contact details in the strings that stay', () => {
    const { value, redacted } = scrubFixture({
      id: 7,
      title: 'Codestorm',
      organisation: { name: 'Example Institute' },
      organiser_name: 'A Person',
      contact_email: 'someone@example.com',
      user: { name: 'A Person', id: 3 },
      registered_users: [{ name: 'Another Person' }],
      created_by: 42,
      details: 'Write to hello@example.com or call 98765 43210.',
    });
    const record = value as Record<string, unknown>;
    expect(record.organisation).toEqual({ name: 'Example Institute' });
    expect(record.title).toBe('Codestorm');
    expect(record.organiser_name).toBeNull();
    expect(record.contact_email).toBeNull();
    expect(record.user).toBeNull();
    expect(record.registered_users).toBeNull();
    expect(record.created_by).toBeNull();
    expect(record.details).not.toMatch(/example\.com|98765/);
    expect(redacted).toContain('$.details');
    expect(redacted).toContain('$.user');
  });

  it('leaves a listing payload still valid against the schema the adapter reads', () => {
    const body: unknown = JSON.parse(unstopFixture('listing-hackathons-p1.json'));
    const scrubbed = scrubFixture(body);
    const parsed = UnstopListingPage.safeParse(scrubbed.value);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.data.data.length).toBe(
      UnstopListingPage.parse(body).data.data.length,
    );
  });

  it('records what it removed in the fixture meta, and says the fixture is a capture', () => {
    const meta = captureMeta(observation(), ['$.user']);
    expect(meta.synthetic).toBe(false);
    expect(meta.captured).toBe(true);
    expect(meta.redacted).toEqual(['$.user']);
    expect(meta.url).toContain('/api/public/');
  });
});

describe('r71Verdict', () => {
  it('holds when every answer was public JSON in the shape the adapter validates', () => {
    expect(r71Verdict([observation(), observation({ status: 200 })])).toEqual({
      holds: true,
      findings: [],
    });
  });

  it('does not hold when nothing was requested', () => {
    expect(r71Verdict([]).holds).toBe(false);
  });

  it.each([
    [{ status: 401 }, /not public to an unauthenticated reader/],
    [{ status: 403 }, /not public to an unauthenticated reader/],
    [{ status: 404 }, /absent at that path/],
    [{ status: 429 }, /rate-limited beyond the robots hints/],
    [{ contentType: 'text/html' }, /not JSON/],
    [{ schemaMatched: false }, /does not match the schema/],
  ])('reports %o as a finding against R71', (overrides, expected) => {
    const verdict = r71Verdict([observation(overrides)]);
    expect(verdict.holds).toBe(false);
    expect(verdict.findings.join(' ')).toMatch(expected);
  });

  it('reports rate-limit headers even on a 200', () => {
    const verdict = r71Verdict([
      observation({ rateLimitHeaders: { 'x-ratelimit-remaining': '9' } }),
    ]);
    expect(verdict.holds).toBe(false);
    expect(verdict.findings.join(' ')).toMatch(/carried rate-limit headers/);
  });
});
