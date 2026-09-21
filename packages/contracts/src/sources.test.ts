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
  UpdateSourceRequest,
} from './sources.js';

/** The source vocabulary (§6.2, §7.1); §7.7's sentences are `source-status.test.ts`. */

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
