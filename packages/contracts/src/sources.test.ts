import { describe, expect, it } from 'vitest';

import { JOB_TRIGGERS } from './jobs.js';
import {
  ADAPTER_KINDS,
  FAILING_SCRAPE_OUTCOMES,
  MATCH_METHODS,
  PRESENCES,
  SCRAPE_METHODS,
  SCRAPE_OUTCOMES,
  SCRAPE_TRIGGERS,
  SCRAPEABLE_COMPLIANCE_STATUSES,
  SourceSummary,
  sourceStatusMessage,
  UpdateSourceRequest,
  type ScrapeErrorKind,
} from './sources.js';

/** The source vocabulary, and §7.7's table as code. */

describe('the enums', () => {
  it('lists the eight adapters §6.2 names', () => {
    expect(ADAPTER_KINDS).toEqual([
      'CTFTIME_API',
      'CLIST_API',
      'DEVPOST',
      'DEVFOLIO',
      'UNSTOP',
      'CONFIGURED_LISTING',
      'MANUAL',
      'URL_IMPORT',
    ]);
  });

  it('keeps scrape triggers identical to job triggers', () => {
    // A scheduled scrape writes a `job_state` row and a `scrape_runs` row; the
    // two must not be able to disagree about why it ran.
    expect([...SCRAPE_TRIGGERS]).toEqual([...JOB_TRIGGERS]);
  });

  it('counts only FAILED against the backoff ladder (R59)', () => {
    expect(FAILING_SCRAPE_OUTCOMES).toEqual(['FAILED']);
    for (const outcome of ['SKIPPED_OFFLINE', 'SKIPPED_BACKOFF', 'BLOCKED_BY_POLICY'] as const) {
      expect(SCRAPE_OUTCOMES).toContain(outcome);
      expect(FAILING_SCRAPE_OUTCOMES).not.toContain(outcome);
    }
  });

  it('allows only the two approved verdicts to be scraped (D-26)', () => {
    expect(SCRAPEABLE_COMPLIANCE_STATUSES).toEqual(['APPROVED', 'APPROVED_WITH_LIMITS']);
  });

  it('allows only GET and HEAD (§7.2)', () => {
    expect(SCRAPE_METHODS).toEqual(['GET', 'HEAD']);
  });

  it('keeps presence and match method as §6.2 lists them', () => {
    expect(PRESENCES).toEqual(['LISTED', 'MISSING', 'GONE']);
    expect(MATCH_METHODS).toEqual(['URL', 'AUTO_SCORE', 'MANUAL', 'NEW']);
  });
});

describe('UpdateSourceRequest', () => {
  it('accepts the five fields an administrator may change', () => {
    const parsed = UpdateSourceRequest.safeParse({
      isEnabled: false,
      cadenceMinutes: 60,
      manualMinIntervalMinutes: 30,
      minDelayMs: 10_000,
      maxRequestsPerRun: 4,
      version: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects compliance_status outright, because `.strict()` says so', () => {
    const parsed = UpdateSourceRequest.safeParse({ complianceStatus: 'APPROVED', version: 1 });
    expect(parsed.success).toBe(false);
  });

  it.each(['allowedPaths', 'trustRank', 'key', 'adapter', 'attributionText'])(
    'rejects %s, which is not an administrator’s to change here',
    (field) => {
      expect(UpdateSourceRequest.safeParse({ [field]: 'x', version: 1 }).success).toBe(false);
    },
  );

  it('always needs a version, so an unconditional write is impossible', () => {
    expect(UpdateSourceRequest.safeParse({ cadenceMinutes: 60 }).success).toBe(false);
  });
});

describe('SourceSummary', () => {
  it('has no configJson field at all', () => {
    expect(Object.keys(SourceSummary.shape)).not.toContain('configJson');
  });
});

describe('sourceStatusMessage (§7.7)', () => {
  const base: {
    sourceName: string;
    freshnessMinutes: number | null;
    nextAttemptLabel: string | null;
  } = {
    sourceName: 'Devfolio',
    freshnessMinutes: 14,
    nextAttemptLabel: '3:45 PM',
  };

  function message(
    outcome: (typeof SCRAPE_OUTCOMES)[number],
    errorKind: ScrapeErrorKind | null = null,
    overrides: Partial<typeof base> = {},
  ): string {
    return sourceStatusMessage({ ...base, ...overrides, outcome, errorKind });
  }

  it('calls offline an info line, not an error', () => {
    const text = message('SKIPPED_OFFLINE');
    expect(text).toContain("You're offline");
    expect(text).toContain('14 min ago');
  });

  it('says "disabled by policy" for our own refusals', () => {
    expect(message('BLOCKED_BY_POLICY')).toBe('Updates from Devfolio are disabled by policy.');
    expect(message('FAILED', 'ROBOTS_DISALLOWED')).toContain('disabled by policy');
  });

  it('names the next attempt when the source asked us to slow down', () => {
    const text = message('FAILED', 'RATE_LIMITED');
    expect(text).toContain('asked us to slow down');
    expect(text).toContain('3:45 PM');
  });

  it('leaves the time out rather than inventing one', () => {
    expect(message('FAILED', 'RATE_LIMITED', { nextAttemptLabel: null })).not.toContain('Next');
  });

  it.each(['NETWORK', 'DNS', 'TIMEOUT'] as const)(
    'says "couldn’t reach" with the last update for %s',
    (kind) => {
      const text = message('FAILED', kind);
      expect(text).toContain("Couldn't reach Devfolio");
      expect(text).toContain('14 min ago');
    },
  );

  it('says the format changed and the source is paused', () => {
    for (const kind of ['SCHEMA_CHANGED', 'PARSE'] as const) {
      expect(message('FAILED', kind)).toContain('page format changed');
      expect(message('FAILED', kind)).toContain('paused');
    }
  });

  it('never suggests working around a certificate or a WAF', () => {
    for (const kind of ['TLS', 'BLOCKED'] as const) {
      const text = message('FAILED', kind);
      expect(text).toContain('so it is skipped');
      expect(text).not.toMatch(/retry with|ignore|bypass|disable/i);
    }
  });

  it('reports hours once the last success is more than an hour old', () => {
    expect(message('FAILED', 'NETWORK', { freshnessMinutes: 125 })).toContain('2 h ago');
  });

  it('says so plainly when there has never been a successful update', () => {
    expect(message('FAILED', 'NETWORK', { freshnessMinutes: null })).toContain(
      'no successful update yet',
    );
  });

  it('gives every outcome a non-empty sentence', () => {
    for (const outcome of SCRAPE_OUTCOMES) {
      expect(message(outcome).length).toBeGreaterThan(10);
    }
  });
});
