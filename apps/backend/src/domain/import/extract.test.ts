import { beforeAll, describe, expect, it } from 'vitest';

import { loadHtmlParser, parseHtml } from '../../adapters/shared/html.js';
import { importFixture } from '../../testing/import.js';
import { expectGolden } from '../../testing/golden.js';
import { normalizeCandidate } from '../normalize/index.js';
import { importFields, rawFromFound } from './candidate.js';
import { afterLabel, extractEvent } from './extract.js';
import { foundAnything } from './found.js';
import { eventFromJsonLd, firstEventNode } from './json-ld.js';

/**
 * The generic single-page extractor (WP-14 step 5, samples 4 and 5).
 *
 * Pure over the fixture's HTML: no transport, no database, no clock of its own.
 * The goldens are the two sample imports the §19 criterion names, recorded so a
 * change to the heuristics shows up as a diff somebody has to read.
 */

const CLOCK = { now: () => new Date('2026-09-22T09:00:00.000Z') };

/**
 * The `url-import` row's default zone, which the service passes for exactly the
 * same reason §7.3 gives a source one: without it every prose date on a campus
 * page is read as UTC and has its precision lowered for it, which throws away
 * the day the professor can see written on the page.
 */
const CONTEXT = { clock: CLOCK, sourceTimezone: 'Asia/Kolkata' };

beforeAll(async () => {
  await loadHtmlParser();
});

function extract(fixture: string, url: string): ReturnType<typeof extractEvent> {
  return extractEvent({ html: importFixture(fixture), url, parse: parseHtml });
}

describe('sample 4: a campus page with schema.org Event JSON-LD', () => {
  const url = 'https://cse.example.edu/innovate-2026';

  it('reads the structured fields with full confidence', () => {
    const found = extract('campus-jsonld.html', url);
    expect(found.title?.origin).toBe('JSON_LD');
    expect(found.title?.confidence).toBe(1);
    expect(found.startsAt?.value).toBe('2026-11-14T09:00:00+05:30');
    expect(found.mode?.value).toBe('OFFLINE');
    expect(found.place?.value).toEqual({
      venueName: 'Example Institute of Technology',
      city: 'Pune',
      state: 'Maharashtra',
      countryCode: 'IN',
    });
    expect(found.feeText?.value).toBe('INR 500');
    expect(found.registrationUrl?.value).toBe('https://cse.example.edu/innovate-2026/register');
  });

  it('lets the page fill what the structured data left out, and never overwrite it', () => {
    const found = extract('campus-jsonld.html', url);
    // `organizer` is in the JSON-LD, so og:site_name never replaces it.
    expect(found.organizerName?.value).toBe('Department of Computer Engineering');
    expect(found.organizerName?.origin).toBe('JSON_LD');
    // The deadline is only in the prose, so the heuristic supplies it.
    expect(found.registrationDeadlineAt?.origin).toBe('HEURISTIC');
    expect(found.registrationDeadlineAt?.value).toContain('5 November 2026');
  });

  it('redacts the contact details in the description (D-29)', () => {
    const found = extract('campus-jsonld.html', url);
    const raw = rawFromFound({ sourceKey: 'url-import', externalKey: url, url }, found);
    const { candidate } = normalizeCandidate(raw, CONTEXT);
    expect(candidate.descriptionMd).not.toMatch(/convenor@example\.edu|98765/);
    expect(candidate.descriptionMd).toContain('[contact details on the source page]');
    expect(candidate.warnings.map((warning) => warning.code)).toContain('PII_REDACTED');
  });

  it('is the golden the §19 criterion names', () => {
    const found = extract('campus-jsonld.html', url);
    const raw = rawFromFound({ sourceKey: 'url-import', externalKey: url, url }, found);
    const { candidate } = normalizeCandidate(raw, CONTEXT);
    expectGolden('url-import/sample-4-jsonld', {
      fields: importFields(found),
      candidate,
    });
  });
});

describe('sample 5: a campus page with Open Graph and prose dates', () => {
  const url = 'https://fest.example.ac.in/techfest-2026';

  it('marks every value it found as a guess, because every value is one', () => {
    const found = extract('campus-og.html', url);
    expect(found.title?.origin).toBe('OPEN_GRAPH');
    expect(found.startsAt?.origin).toBe('HEURISTIC');
    expect(found.startsAt?.confidence).toBeLessThan(0.8);
    expect(found.registrationDeadlineAt?.value).toContain('30 November 2026');
    expect(found.teamSizeText?.value).toContain('teams of 2');
    expect(found.feeText?.value).toContain('Free');
  });

  it('says what it did not find, which is half of what the preview shows', () => {
    const { fieldsMissing } = importFields(extract('campus-og.html', url));
    expect(fieldsMissing).toContain('Place');
    expect(fieldsMissing).toContain('Ends');
  });

  it('turns the prose dates into instants through WP-08a, with its warnings', () => {
    const found = extract('campus-og.html', url);
    const raw = rawFromFound({ sourceKey: 'url-import', externalKey: url, url }, found);
    const { candidate } = normalizeCandidate(raw, CONTEXT);
    expect(candidate.startsAt).toBeDefined();
    expect(candidate.registrationDeadlineAt).toBeDefined();
    expect(candidate.teamSize?.max).toBe(2);
    expect(candidate.fee?.known).toBe(true);
    expect(candidate.fee?.minor).toBe(0);
  });

  it('is the golden the §19 criterion names', () => {
    const found = extract('campus-og.html', url);
    const raw = rawFromFound({ sourceKey: 'url-import', externalKey: url, url }, found);
    const { candidate } = normalizeCandidate(raw, CONTEXT);
    expectGolden('url-import/sample-5-open-graph', {
      fields: importFields(found),
      candidate,
    });
  });
});

describe('what the extractor refuses to invent', () => {
  it('finds nothing in a page that says nothing', () => {
    const found = extractEvent({
      html: '<!doctype html><html><head><title></title></head><body></body></html>',
      url: 'https://example.edu/empty',
      parse: parseHtml,
    });
    expect(foundAnything(found)).toBe(false);
  });

  it('reads no Event out of JSON-LD that describes something else', () => {
    expect(
      firstEventNode(['{"@context":"https://schema.org","@type":"Organization","name":"X"}']),
    ).toBeUndefined();
    expect(eventFromJsonLd(['not json at all'])).toEqual({});
  });

  it('finds an Event inside an @graph, which is how most CMSs emit it', () => {
    const node = firstEventNode([
      '{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Event","name":"X"}]}',
    ]);
    expect(node?.name).toBe('X');
  });

  it('takes the words after a label and stops at the end of the value', () => {
    expect(
      afterLabel('Registration deadline: 30 Sep 2026. Fee: free', ['registration deadline']),
    ).toBe('30 Sep 2026');
    // The value stops where the next label starts, not at a full stop that
    // a table of labels does not have.
    expect(
      afterLabel('Registration fee Free Prize pool ₹50,000', ['registration fee'], {
        stops: ['prize pool'],
      }),
    ).toBe('Free');
    expect(afterLabel('nothing here', ['registration deadline'])).toBeUndefined();
  });
});
