import { describe, expect, it } from 'vitest';

import { sourceHealthOf, sourceStatusMessage } from './source-status.js';
import { SCRAPE_OUTCOMES, type ScrapeErrorKind } from './sources.js';

/** §7.7's table as code, and the health one finished run leaves behind (§16.1). */

describe('sourceHealthOf (§16.1, WP-16b)', () => {
  const base = {
    isEnabled: true,
    complianceStatus: 'APPROVED_WITH_LIMITS' as const,
    outcome: null,
    errorKind: null,
  };

  it('calls a source nobody may run "paused by policy", whatever its last run said', () => {
    expect(sourceHealthOf({ ...base, isEnabled: false, outcome: 'SUCCESS' })).toBe(
      'PAUSED_BY_POLICY',
    );
    expect(
      sourceHealthOf({ ...base, complianceStatus: 'MANUAL_IMPORT_ONLY', outcome: 'SUCCESS' }),
    ).toBe('PAUSED_BY_POLICY');
  });

  it('keeps D-23 apart from a failure', () => {
    expect(sourceHealthOf({ ...base, outcome: 'SKIPPED_OFFLINE' })).toBe('OFFLINE');
    expect(sourceHealthOf({ ...base, outcome: 'FAILED', errorKind: 'NETWORK' })).toBe('FAILING');
  });

  it('counts a backoff as failing and a robots refusal as policy', () => {
    expect(sourceHealthOf({ ...base, outcome: 'SKIPPED_BACKOFF' })).toBe('FAILING');
    expect(sourceHealthOf({ ...base, outcome: 'FAILED', errorKind: 'ROBOTS_DISALLOWED' })).toBe(
      'PAUSED_BY_POLICY',
    );
  });

  it('is NEVER_RUN before the first run and OK after a successful one', () => {
    expect(sourceHealthOf(base)).toBe('NEVER_RUN');
    expect(sourceHealthOf({ ...base, outcome: 'SUCCESS' })).toBe('OK');
    expect(sourceHealthOf({ ...base, outcome: 'PARTIAL' })).toBe('OK');
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
