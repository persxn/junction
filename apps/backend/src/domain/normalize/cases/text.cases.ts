import { REDACTED } from '../redact.js';
import type { NormalizeCase } from './case.js';

/**
 * Text, URLs and contact-detail redaction (§7.3, D-29).
 *
 * The redaction cases come in pairs on purpose. Over-redacting is as much a bug
 * as under-redacting: turning "₹1,00,000" or "2026" into a placeholder corrupts
 * the data a professor actually uses, so the negative cases below are as
 * load-bearing as the positive ones.
 */

export const TEXT_CASES: readonly NormalizeCase[] = [
  // ---- HTML → Markdown -----------------------------------------------------
  {
    name: 'HTML becomes Markdown and no raw HTML survives',
    input: { description: '<p>Build something <strong>useful</strong>.</p>' },
    expect: { fields: { descriptionMd: 'Build something **useful**.' } },
  },
  {
    name: 'a script tag is removed entirely, contents and all',
    input: { description: '<p>Hello</p><script>alert(1)</script>' },
    expect: { warnings: ['HTML_SANITIZED'], fields: { descriptionMd: 'Hello' } },
  },
  {
    name: 'an inline event handler does not survive',
    input: { description: '<p onclick="steal()">Click</p>' },
    expect: { fields: { descriptionMd: 'Click' } },
  },
  {
    name: 'an iframe is dropped',
    input: { description: '<p>Watch</p><iframe src="https://evil.example"></iframe>' },
    expect: { warnings: ['HTML_SANITIZED'], fields: { descriptionMd: 'Watch' } },
  },
  {
    name: 'a list becomes a Markdown list',
    input: { description: '<ul><li>One</li><li>Two</li></ul>' },
    expect: { fields: { descriptionMd: '-   One\n-   Two' } },
  },
  {
    name: 'a heading becomes an ATX heading',
    input: { description: '<h2>Rules</h2><p>Be nice.</p>' },
    expect: { fields: { descriptionMd: '## Rules\n\nBe nice.' } },
  },
  {
    name: 'a link keeps its href',
    input: { description: '<p>See <a href="https://example.org/rules">the rules</a>.</p>' },
    expect: { fields: { descriptionMd: 'See [the rules](https://example.org/rules).' } },
  },
  {
    name: 'a javascript: link loses its href',
    input: { description: '<p><a href="javascript:evil()">Click</a></p>' },
    expect: { warnings: ['HTML_SANITIZED'] },
  },
  {
    name: 'plain text passes through as itself',
    input: { description: 'Just a sentence.' },
    expect: { fields: { descriptionMd: 'Just a sentence.' } },
  },
  {
    // Devfolio sends Markdown, not HTML. Running it through the HTML converter
    // escaped every marker, so `**GNIT**` rendered as literal `\*\*GNIT\*\*`.
    name: 'a source that already sends Markdown keeps its emphasis unescaped',
    input: { description: '**RECURSIVE** is a hackathon at *GNIT*.' },
    expect: { fields: { descriptionMd: '**RECURSIVE** is a hackathon at *GNIT*.' } },
  },
  {
    name: 'Markdown links and lists survive the passthrough intact',
    input: { description: '- One\n- Two\n\nSee [the rules](https://example.org/r).' },
    expect: {
      fields: { descriptionMd: '- One\n- Two\n\nSee [the rules](https://example.org/r).' },
    },
  },
  {
    name: 'text with anything tag-shaped still takes the sanitizing path',
    input: { description: '**Bold** and <script>alert(1)</script>' },
    expect: { warnings: ['HTML_SANITIZED'] },
  },
  {
    name: 'an empty description leaves both text fields absent',
    input: { description: '   ' },
    expect: { absent: ['descriptionMd', 'summary'] },
  },

  // ---- Summary -------------------------------------------------------------
  {
    name: 'a short description becomes the summary verbatim',
    input: { description: '<p>A weekend hackathon.</p>' },
    expect: { fields: { summary: 'A weekend hackathon.' } },
  },
  {
    name: 'a long description is cut on a word boundary and ellipsized',
    input: { description: `<p>${'word '.repeat(200).trim()}</p>` },
    // The exact cut is asserted by the runner's word-boundary invariant; here
    // the point is only that a 999-character description still yields a summary.
    expect: { fields: { 'summary.length': 495 } },
  },
  {
    name: 'Markdown syntax does not leak into the summary',
    input: { description: '<h2>Rules</h2><p>Be <strong>nice</strong>.</p>' },
    expect: { fields: { summary: 'Rules Be nice.' } },
  },

  // ---- Titles --------------------------------------------------------------
  {
    name: 'a title keeps its punctuation but loses stray whitespace',
    input: { title: '  Hack   the   North  2026 ' },
    expect: { fields: { title: 'Hack the North 2026', titleRaw: '  Hack   the   North  2026 ' } },
  },

  // ---- URLs ----------------------------------------------------------------
  {
    name: 'tracking parameters are stripped from the canonical URL',
    input: { url: 'https://example.org/e/1?utm_source=news&utm_campaign=x&id=7' },
    expect: { fields: { url: 'https://example.org/e/1?id=7' } },
  },
  {
    name: 'a URL that was only tracking loses its query string entirely',
    input: { url: 'https://example.org/e/1?utm_source=news' },
    expect: { fields: { url: 'https://example.org/e/1' } },
  },
  {
    name: 'fbclid and gclid go too',
    input: { url: 'https://example.org/e/1?fbclid=abc&gclid=def' },
    expect: { fields: { url: 'https://example.org/e/1' } },
  },
  {
    name: 'the host is lower-cased and the fragment dropped',
    input: { url: 'https://Example.ORG/Events/1#register' },
    expect: { fields: { url: 'https://example.org/Events/1' } },
  },
  {
    name: 'a default port is removed',
    input: { url: 'https://example.org:443/e/1' },
    expect: { fields: { url: 'https://example.org/e/1' } },
  },
  {
    name: 'a non-default port is kept',
    input: { url: 'https://example.org:8443/e/1' },
    expect: { fields: { url: 'https://example.org:8443/e/1' } },
  },
  {
    name: 'a non-http registration URL is refused with a warning',
    input: { registrationUrl: 'javascript:alert(1)' },
    expect: { warnings: ['URL_INVALID'], absent: ['registrationUrl'] },
  },
  {
    name: 'a malformed official URL is refused with a warning',
    input: { officialUrl: 'not a url at all' },
    expect: { warnings: ['URL_INVALID'], absent: ['officialUrl'] },
  },
  {
    name: 'an http official URL is kept',
    input: { officialUrl: 'http://example.org/about' },
    expect: { fields: { officialUrl: 'http://example.org/about' } },
  },

  // ---- Redaction: it must happen -------------------------------------------
  {
    name: 'an e-mail inside a description is replaced',
    input: { description: '<p>Questions? Write to organisers@iitb.ac.in today.</p>' },
    expect: {
      warnings: ['PII_REDACTED'],
      fields: { descriptionMd: `Questions? Write to ${REDACTED} today.` },
    },
  },
  {
    name: 'a phone number with spaces and +91 is replaced',
    input: { description: '<p>Call +91 98765 43210 for details.</p>' },
    expect: {
      warnings: ['PII_REDACTED'],
      fields: { descriptionMd: `Call ${REDACTED} for details.` },
    },
  },
  {
    name: 'a hyphenated phone number is replaced',
    input: { description: '<p>Reach us at 98765-43210.</p>' },
    expect: { warnings: ['PII_REDACTED'], fields: { descriptionMd: `Reach us at ${REDACTED}.` } },
  },
  {
    name: 'a bare ten-digit number is replaced',
    input: { description: '<p>Contact 9876543210 now.</p>' },
    expect: { warnings: ['PII_REDACTED'], fields: { descriptionMd: `Contact ${REDACTED} now.` } },
  },
  {
    name: 'an obfuscated e-mail is replaced too',
    input: { description: '<p>Mail us: team [at] example [dot] com</p>' },
    expect: { warnings: ['PII_REDACTED'] },
  },
  {
    name: 'consecutive contact details collapse into one placeholder',
    input: { description: '<p>Contact: 98765 43210 / a@b.com</p>' },
    expect: { fields: { descriptionMd: `Contact: ${REDACTED}` } },
  },
  {
    name: 'contact details with real words between them stay separate',
    // Collapsing here would delete "or write to", which is not ours to remove.
    input: { description: '<p>Call 98765 43210 or write to a@b.com</p>' },
    expect: { fields: { descriptionMd: `Call ${REDACTED} or write to ${REDACTED}` } },
  },
  {
    name: 'contact details in the eligibility text are redacted as well',
    input: { eligibilityText: 'Open to all. Queries: dean@iitb.ac.in' },
    expect: {
      warnings: ['PII_REDACTED'],
      fields: { eligibilityText: `Open to all. Queries: ${REDACTED}` },
    },
  },
  {
    name: 'contact details in the requirements text are redacted',
    input: { requirementsText: 'Bring a laptop. Helpdesk: +91 22 1234 5678' },
    expect: { warnings: ['PII_REDACTED'] },
  },

  // ---- Redaction: it must NOT happen ---------------------------------------
  {
    name: 'a four-digit year is not a phone number',
    input: { description: '<p>The 2026 edition runs in March.</p>' },
    expect: {
      noWarnings: ['PII_REDACTED'],
      fields: { descriptionMd: 'The 2026 edition runs in March.' },
    },
  },
  {
    name: 'an Indian-format prize amount is not a phone number',
    input: { description: '<p>Prize pool of ₹50,000 for the winners.</p>' },
    expect: {
      noWarnings: ['PII_REDACTED'],
      fields: { descriptionMd: 'Prize pool of ₹50,000 for the winners.' },
    },
  },
  {
    name: 'a prize table full of digits is untouched',
    input: { description: '<p>1st ₹50,000 · 2nd ₹25,000 · 3rd ₹10,000</p>' },
    expect: { noWarnings: ['PII_REDACTED'] },
  },
  {
    name: 'a URL containing digits is untouched',
    input: { description: '<p>See https://example.org/events/2026/12345 for details.</p>' },
    expect: { noWarnings: ['PII_REDACTED'] },
  },
  {
    name: 'an ISO date is not a phone number',
    input: { description: '<p>Submissions close 2026-10-27.</p>' },
    expect: {
      noWarnings: ['PII_REDACTED'],
      fields: { descriptionMd: 'Submissions close 2026-10-27.' },
    },
  },
  {
    name: 'a six-digit PIN code is not a phone number',
    input: { description: '<p>Venue is at Powai, Mumbai 400076.</p>' },
    expect: { noWarnings: ['PII_REDACTED'] },
  },
  {
    name: 'a time range is not a phone number',
    input: { description: '<p>Open 09:00 to 18:00 daily.</p>' },
    expect: { noWarnings: ['PII_REDACTED'] },
  },
];
