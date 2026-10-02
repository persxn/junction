import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { fakeTransport, movableClock, testScrapingHttp } from '../../testing/scraping.js';
import type { SourceCredential, SourceRequestContext } from './types.js';

/**
 * R77 through the client: the exemption needs the source's *documented API
 * credential* — not the professor's session — and the client says once per run
 * that it used it.
 */

const ROBOTS = 'https://clist.by/robots.txt';
const API = 'https://clist.by/api/v4/contest/?limit=100';
const API_NEXT = 'https://clist.by/api/v4/contest/?limit=100&offset=100';
const KEY: SourceCredential = { kind: 'API_KEY', header: 'Authorization', value: 'ApiKey u:k' };

function context(overrides: Partial<SourceRequestContext> = {}): SourceRequestContext {
  return {
    key: 'clist',
    name: 'CLIST',
    complianceStatus: 'APPROVED_WITH_LIMITS',
    isEnabled: true,
    allowedPaths: ['clist.by/api/v4/contest/'],
    minDelayMs: 6_000,
    maxRequestsPerRun: 4,
    robotsExemption: {
      paths: ['clist.by/api/v4/contest/'],
      reason: 'A documented, keyed API with a published rate limit.',
      reviewedBy: 'architect, M1 review',
      reviewedAt: '2026-09-22',
    },
    ...overrides,
  };
}

function transport(): ReturnType<typeof fakeTransport> {
  return fakeTransport({
    [ROBOTS]: { body: 'User-agent: *\nDisallow: /api/\n' },
    [API]: { body: '{"objects":[]}' },
    [API_NEXT]: { body: '{"objects":[]}' },
  });
}

describe('the robots exemption in the client (R77)', () => {
  it('is used with the API key, and logged once per run however many requests use it', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    const fake = transport();
    const http = testScrapingHttp({
      transport: fake,
      clock: movableClock('2026-09-22T10:00:00.000Z'),
      logger,
    });
    const client = http.clientFor(context({ credential: KEY }), new AbortController().signal);
    await client.get(API);
    await client.get(API_NEXT);
    expect(fake.countFor(API)).toBe(1);
    expect(fake.countFor(API_NEXT)).toBe(1);
    expect(lines.filter((line) => line.includes('reviewed exemption'))).toHaveLength(1);
  });

  it('is not unlocked by a session: only the documented API credential counts', async () => {
    const fake = transport();
    const http = testScrapingHttp({ transport: fake, clock: movableClock('2026-09-22T10:00:00Z') });
    const session: SourceCredential = { ...KEY, kind: 'SESSION', hosts: ['clist.by'] };
    const client = http.clientFor(context({ session }), new AbortController().signal);
    await expect(client.get(API)).rejects.toMatchObject({ refusal: 'ROBOTS_DISALLOWED' });
    expect(fake.countFor(API)).toBe(0);
  });
});
