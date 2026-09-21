import { describe, expect, it } from 'vitest';

import {
  hostMatches,
  normalizeImportUrl,
  registrableParent,
  resolveImportRoute,
  type ImportSource,
} from './route.js';

/** The pure half of URL-import dispatch (WP-14 step 2, D-30). */

const DEVPOST: ImportSource = {
  key: 'devpost',
  name: 'Devpost',
  complianceStatus: 'MANUAL_IMPORT_ONLY',
  isEnabled: false,
  hosts: ['devpost.com', '*.devpost.com'],
  canDetail: false,
  complianceNotes: 'Its Terms prohibit scraping.',
};

const DEVFOLIO: ImportSource = {
  key: 'devfolio',
  name: 'Devfolio',
  complianceStatus: 'APPROVED_WITH_LIMITS',
  isEnabled: true,
  hosts: ['devfolio.co', '*.devfolio.co'],
  canDetail: true,
  complianceNotes: 'Public pages only.',
};

const TABLE: readonly ImportSource[] = [DEVPOST, DEVFOLIO];

describe('normalizeImportUrl', () => {
  it('keeps an https page, lower-cases the host and drops www.', () => {
    expect(normalizeImportUrl('HTTPS://WWW.Example.edu/Events/One')).toBe(
      'https://example.edu/Events/One',
    );
  });

  it('strips tracking parameters and the fragment, so one page is one URL (§7.5)', () => {
    expect(normalizeImportUrl('https://example.edu/e?utm_source=mail&id=7&fbclid=x#agenda')).toBe(
      'https://example.edu/e?id=7',
    );
  });

  it.each([
    ['http://example.edu/e', 'plain http'],
    ['ftp://example.edu/e', 'another scheme'],
    ['file:///C:/events.html', 'a local file'],
    ['data:text/html,<h1>x</h1>', 'a data URL'],
    ['https://192.168.1.4/events', 'an IPv4 literal'],
    ['https://[2001:db8::1]/events', 'an IPv6 literal'],
    ['https://user:pass@example.edu/e', 'embedded credentials'],
    ['not a url at all', 'a bare string'],
    ['', 'nothing'],
  ])('refuses %s (%s)', (raw) => {
    expect(normalizeImportUrl(raw)).toBeUndefined();
  });
});

describe('host matching', () => {
  it('matches a wildcard against the domain and its sub-domains', () => {
    expect(hostMatches('hack.devfolio.co', '*.devfolio.co')).toBe(true);
    expect(hostMatches('devfolio.co', '*.devfolio.co')).toBe(true);
    expect(hostMatches('devfolio.co.evil.test', '*.devfolio.co')).toBe(false);
  });

  it('matches a plain entry exactly', () => {
    expect(hostMatches('unstop.com', 'unstop.com')).toBe(true);
    expect(hostMatches('careers.unstop.com', 'unstop.com')).toBe(false);
  });

  it('finds the registrable parent, including two-label public suffixes', () => {
    expect(registrableParent('hack.devfolio.co')).toBe('devfolio.co');
    expect(registrableParent('cse.iitb.ac.in')).toBe('iitb.ac.in');
    expect(registrableParent('example.edu')).toBeUndefined();
  });
});

describe('resolveImportRoute', () => {
  it('sends an approved source with a single-page read to its adapter', () => {
    const route = resolveImportRoute('https://codestorm.devfolio.co/', TABLE);
    expect(route.disposition).toBe('ADAPTER');
  });

  it('refuses a MANUAL_IMPORT_ONLY domain, and says so in the source’s own words', () => {
    const route = resolveImportRoute('https://devpost.com/software/thing', TABLE);
    expect(route.disposition).toBe('MANUAL_ONLY');
    expect(route.disposition === 'MANUAL_ONLY' && route.reason).toContain(
      "Devpost doesn't allow automated reading",
    );
    expect(route.disposition === 'MANUAL_ONLY' && route.reason).toContain(
      'Its Terms prohibit scraping.',
    );
  });

  it('refuses a sub-domain of a MANUAL_IMPORT_ONLY domain too', () => {
    expect(resolveImportRoute('https://sub.devpost.com/x', TABLE).disposition).toBe('MANUAL_ONLY');
  });

  it('sends an unknown campus host to the generic reader', () => {
    expect(resolveImportRoute('https://cse.example.ac.in/fest', TABLE).disposition).toBe('GENERIC');
  });

  it('refuses a link that is not a page we will follow, before any table is read', () => {
    expect(resolveImportRoute('http://devfolio.co/x', TABLE).disposition).toBe('INVALID');
    expect(resolveImportRoute('https://10.0.0.1/x', TABLE).disposition).toBe('INVALID');
  });

  it('never fetches an approved source that has no single-page read', () => {
    const noDetail = { ...DEVFOLIO, canDetail: false };
    const route = resolveImportRoute('https://x.devfolio.co/', [noDetail]);
    expect(route.disposition).toBe('MANUAL_ONLY');
    expect(route.disposition === 'MANUAL_ONLY' && route.reason).toContain(
      "can't be read one page at a time",
    );
  });

  it('treats a switched-off source as manual-only rather than reading it anyway', () => {
    const off = { ...DEVFOLIO, isEnabled: false };
    const route = resolveImportRoute('https://x.devfolio.co/', [off]);
    expect(route.disposition).toBe('MANUAL_ONLY');
    expect(route.disposition === 'MANUAL_ONLY' && route.reason).toContain('switched off');
  });
});
