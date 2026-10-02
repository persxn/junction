import { describe, expect, it } from 'vitest';

import {
  assessRequest,
  effectiveDelayMs,
  GATE_REFUSALS,
  MIN_DELAY_FLOOR_MS,
  refusalErrorKind,
  type GateInput,
} from './gate.js';
import { isPathAllowed } from './paths.js';

/**
 * The compliance gate is the one piece of this work package that has to be
 * right whatever else is broken, so it is tested as pure logic with no
 * transport, no database and no clock anywhere near it.
 */

const CTFTIME_PATHS = ['ctftime.org/api/v1/events/', 'ctftime.org/api/v1/events/{id}/'];
const DEVFOLIO_PATHS = ['devfolio.co/hackathons', '*.devfolio.co', '!api.devfolio.co'];

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    complianceStatus: 'APPROVED_WITH_LIMITS',
    isEnabled: true,
    allowedPaths: CTFTIME_PATHS,
    robots: 'ALLOWED',
    url: 'https://ctftime.org/api/v1/events/?limit=50',
    method: 'GET',
    setupComplete: true,
    requestsMade: 0,
    cap: 6,
    ...overrides,
  };
}

describe('assessRequest', () => {
  it('allows a request that satisfies every rule', () => {
    expect(assessRequest(input())).toEqual({ allowed: true });
  });

  it('refuses before anything else when setup is not finished (A10/R44)', () => {
    // Deliberately broken in every other way too: the setup answer must win, so
    // that "no scraping before setup" is not something another rule can mask.
    const decision = assessRequest(
      input({
        setupComplete: false,
        complianceStatus: 'MANUAL_IMPORT_ONLY',
        isEnabled: false,
        url: 'http://evil.test/',
      }),
    );
    expect(decision).toMatchObject({ allowed: false, refusal: 'SETUP_INCOMPLETE' });
  });

  it.each(['MANUAL_IMPORT_ONLY', 'PENDING_REVIEW', 'BLOCKED'] as const)(
    'refuses a %s source (D-26, R60)',
    (complianceStatus) => {
      expect(assessRequest(input({ complianceStatus }))).toMatchObject({
        allowed: false,
        refusal: 'NOT_APPROVED',
      });
    },
  );

  it.each(['APPROVED', 'APPROVED_WITH_LIMITS'] as const)('allows a %s source', (status) => {
    expect(assessRequest(input({ complianceStatus: status })).allowed).toBe(true);
  });

  it('refuses a source an administrator switched off', () => {
    expect(assessRequest(input({ isEnabled: false }))).toMatchObject({
      allowed: false,
      refusal: 'DISABLED',
    });
  });

  it('refuses anything that is not https', () => {
    expect(assessRequest(input({ url: 'http://ctftime.org/api/v1/events/' }))).toMatchObject({
      allowed: false,
      refusal: 'SCHEME_NOT_ALLOWED',
    });
  });

  it('refuses a method other than GET or HEAD', () => {
    expect(
      assessRequest(input({ method: 'POST' as unknown as GateInput['method'] })),
    ).toMatchObject({ allowed: false, refusal: 'METHOD_NOT_ALLOWED' });
  });

  it('allows HEAD, which is what the reachability probe uses (R61)', () => {
    expect(assessRequest(input({ method: 'HEAD' })).allowed).toBe(true);
  });

  it('refuses a URL outside allowed_paths_json', () => {
    expect(assessRequest(input({ url: 'https://ctftime.org/event/1234/' }))).toMatchObject({
      allowed: false,
      refusal: 'PATH_NOT_ALLOWED',
    });
  });

  it('refuses the right path on the wrong host', () => {
    expect(assessRequest(input({ url: 'https://evil.test/api/v1/events/' }))).toMatchObject({
      allowed: false,
      refusal: 'PATH_NOT_ALLOWED',
    });
  });

  it('refuses when robots disallows, and only after the path has passed', () => {
    expect(assessRequest(input({ robots: 'DISALLOWED' }))).toMatchObject({
      allowed: false,
      refusal: 'ROBOTS_DISALLOWED',
    });
  });

  it('treats an unknown robots answer as "ask again later", not a refusal', () => {
    expect(assessRequest(input({ robots: 'UNKNOWN' })).allowed).toBe(true);
  });

  it('refuses once the run has spent its request cap', () => {
    expect(assessRequest(input({ requestsMade: 6, cap: 6 }))).toMatchObject({
      allowed: false,
      refusal: 'REQUEST_CAP_REACHED',
    });
    expect(assessRequest(input({ requestsMade: 5, cap: 6 })).allowed).toBe(true);
  });

  it('refuses a malformed URL rather than throwing', () => {
    expect(assessRequest(input({ url: 'not a url' }))).toMatchObject({
      allowed: false,
      refusal: 'PATH_NOT_ALLOWED',
    });
  });

  it('gives every refusal a reason a person could read', () => {
    for (const refusal of GATE_REFUSALS) {
      expect(refusal).toMatch(/^[A-Z_]+$/);
    }
    const decision = assessRequest(input({ isEnabled: false }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason.length).toBeGreaterThan(10);
    }
  });

  it('maps only the robots refusal to its own error kind', () => {
    expect(refusalErrorKind('ROBOTS_DISALLOWED')).toBe('ROBOTS_DISALLOWED');
    for (const refusal of GATE_REFUSALS.filter((value) => value !== 'ROBOTS_DISALLOWED')) {
      expect(refusalErrorKind(refusal)).toBe('BLOCKED');
    }
  });
});

describe('allowed_paths_json', () => {
  it('matches a path prefix on the right host', () => {
    expect(isPathAllowed(new URL('https://ctftime.org/api/v1/events/'), CTFTIME_PATHS)).toBe(true);
    expect(isPathAllowed(new URL('https://ctftime.org/api/v1/events/1234/'), CTFTIME_PATHS)).toBe(
      true,
    );
  });

  it('does not match a different path on the right host', () => {
    expect(isPathAllowed(new URL('https://ctftime.org/api/v1/teams/'), CTFTIME_PATHS)).toBe(false);
    expect(isPathAllowed(new URL('https://ctftime.org/'), CTFTIME_PATHS)).toBe(false);
  });

  it('is case-insensitive about the host and case-sensitive about the path', () => {
    expect(isPathAllowed(new URL('https://CTFTime.ORG/api/v1/events/'), CTFTIME_PATHS)).toBe(true);
    expect(isPathAllowed(new URL('https://ctftime.org/API/v1/events/'), CTFTIME_PATHS)).toBe(false);
  });

  it('matches a {segment} placeholder against exactly one segment', () => {
    const paths = ['example.test/a/{id}/b'];
    expect(isPathAllowed(new URL('https://example.test/a/42/b'), paths)).toBe(true);
    expect(isPathAllowed(new URL('https://example.test/a/42/43/b'), paths)).toBe(false);
    expect(isPathAllowed(new URL('https://example.test/a//b'), paths)).toBe(false);
  });

  it('matches Devfolio sub-domains through the wildcard', () => {
    expect(isPathAllowed(new URL('https://devfolio.co/hackathons'), DEVFOLIO_PATHS)).toBe(true);
    expect(isPathAllowed(new URL('https://recursiveacm.devfolio.co/'), DEVFOLIO_PATHS)).toBe(true);
  });

  it('never matches devfolio.co itself through the wildcard', () => {
    // `*.devfolio.co` is sub-domains only; the bare host is allowed by its own
    // entry and only on /hackathons.
    expect(isPathAllowed(new URL('https://devfolio.co/settings'), DEVFOLIO_PATHS)).toBe(false);
  });

  it('refuses api.devfolio.co, which the wildcard would otherwise allow (D-26)', () => {
    expect(isPathAllowed(new URL('https://api.devfolio.co/hackathons'), DEVFOLIO_PATHS)).toBe(
      false,
    );
    expect(isPathAllowed(new URL('https://api.devfolio.co/'), DEVFOLIO_PATHS)).toBe(false);
  });

  it('allows nothing when the list is empty (Unstop, Devpost)', () => {
    expect(isPathAllowed(new URL('https://unstop.com/hackathons/'), [])).toBe(false);
  });

  it('ignores an entry that does not parse rather than allowing everything', () => {
    expect(isPathAllowed(new URL('https://example.test/a'), ['', '   ', '/a'])).toBe(false);
  });
});

describe('effectiveDelayMs (A9/D-28)', () => {
  it('never goes below the three-second floor', () => {
    expect(effectiveDelayMs(0, undefined)).toBe(MIN_DELAY_FLOOR_MS);
    expect(effectiveDelayMs(500, 1)).toBe(MIN_DELAY_FLOOR_MS);
  });

  it('takes the source setting when it is the largest', () => {
    expect(effectiveDelayMs(10_000, 5)).toBe(10_000);
  });

  it("takes robots' Crawl-delay when it is the largest", () => {
    expect(effectiveDelayMs(3_000, 10)).toBe(10_000);
  });

  it('is the maximum of all three, not the last one that was set', () => {
    expect(effectiveDelayMs(6_000, 10)).toBe(10_000);
    expect(effectiveDelayMs(12_000, 10)).toBe(12_000);
  });

  it('ignores a nonsensical Crawl-delay instead of trusting it', () => {
    expect(effectiveDelayMs(3_000, Number.NaN)).toBe(MIN_DELAY_FLOOR_MS);
    expect(effectiveDelayMs(3_000, -5)).toBe(MIN_DELAY_FLOOR_MS);
  });
});

describe('the reviewed robots exemption (R77)', () => {
  const CLIST_PATHS = ['clist.by/api/v4/contest/', 'clist.by/api/v4/resource/'];
  const EXEMPTION = {
    paths: ['clist.by/api/v4/contest/'],
    reason: 'A documented, keyed API with a published rate limit.',
    reviewedBy: 'architect, M1 review',
    reviewedAt: '2026-09-22',
  };

  function clist(overrides: Partial<GateInput> = {}): GateInput {
    return input({
      allowedPaths: CLIST_PATHS,
      url: 'https://clist.by/api/v4/contest/?limit=100',
      robots: 'DISALLOWED',
      robotsExemption: EXEMPTION,
      credentialPresent: true,
      ...overrides,
    });
  }

  it('is honoured when all three conditions hold, and says so', () => {
    expect(assessRequest(clist())).toEqual({ allowed: true, robotsExempted: true });
  });

  it('is ignored without the credential', () => {
    expect(assessRequest(clist({ credentialPresent: false }))).toMatchObject({
      allowed: false,
      refusal: 'ROBOTS_DISALLOWED',
    });
  });

  it('is ignored outside its own paths, even inside the allowed ones', () => {
    expect(
      assessRequest(clist({ url: 'https://clist.by/api/v4/resource/?limit=10' })),
    ).toMatchObject({ allowed: false, refusal: 'ROBOTS_DISALLOWED' });
  });

  it('never widens the allowed paths', () => {
    const wide = { ...EXEMPTION, paths: ['clist.by/'] };
    expect(
      assessRequest(clist({ robotsExemption: wide, url: 'https://clist.by/standings/' })),
    ).toMatchObject({ allowed: false, refusal: 'PATH_NOT_ALLOWED' });
  });

  it.each([
    ['no reviewer', { reviewedBy: '  ' }],
    ['no reason', { reason: '' }],
    ['no parseable date', { reviewedAt: 'last week' }],
  ])('is ignored with %s', (_label, change) => {
    expect(assessRequest(clist({ robotsExemption: { ...EXEMPTION, ...change } }))).toMatchObject({
      allowed: false,
      refusal: 'ROBOTS_DISALLOWED',
    });
  });

  it('is not needed where robots allows the path', () => {
    expect(assessRequest(clist({ robots: 'ALLOWED' }))).toEqual({ allowed: true });
  });
});
