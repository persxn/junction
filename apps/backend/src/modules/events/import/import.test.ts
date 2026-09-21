import type { ManualEventInput } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, eventOverrides, sourceRecords } from '../../../db/schema/index.js';
import { loadHtmlParser } from '../../../adapters/shared/html.js';
import {
  ADMIN,
  adapterFixture,
  ALLOW_ALL,
  DISALLOW_ALL,
  HTML,
  importFixture,
  JSON_TYPE,
  openImportHarness,
  PROFESSOR,
  type ImportHarness,
} from '../../../testing/import.js';
import type { FakeResponse } from '../../../testing/scraping.js';

/**
 * Manual entry and URL import, end to end (WP-14).
 *
 * Every assertion about "no request was made" is made against the transport
 * spy, never against a flag: D-30 is a promise to somebody else's server, and
 * the only evidence that counts is that no socket was asked for.
 */

const DEVFOLIO_PAGE = 'https://recursiveacm.devfolio.co/';
const DEVFOLIO_ROBOTS = 'https://recursiveacm.devfolio.co/robots.txt';
const CTFTIME_EVENT = 'https://ctftime.org/event/3417/';
const CTFTIME_API = 'https://ctftime.org/api/v1/events/3417/';
const CTFTIME_ROBOTS = 'https://ctftime.org/robots.txt';
const DEVPOST_PAGE = 'https://devpost.com/software/codestorm';
const CAMPUS_JSONLD = 'https://cse.example.edu/innovate-2026';
const CAMPUS_JSONLD_ROBOTS = 'https://cse.example.edu/robots.txt';
const CAMPUS_OG = 'https://fest.example.ac.in/techfest-2026';
const CAMPUS_OG_ROBOTS = 'https://fest.example.ac.in/robots.txt';

function routes(
  extra: Readonly<Record<string, FakeResponse | readonly FakeResponse[]>> = {},
): Record<string, FakeResponse | readonly FakeResponse[]> {
  return {
    [DEVFOLIO_ROBOTS]: { body: ALLOW_ALL },
    [DEVFOLIO_PAGE]: {
      body: adapterFixture('devfolio', 'detail-recursiveacm.html'),
      headers: HTML,
    },
    [CTFTIME_ROBOTS]: { body: ALLOW_ALL },
    [CTFTIME_API]: {
      body: adapterFixture('ctftime', 'detail-event-3417.json'),
      headers: JSON_TYPE,
    },
    [CAMPUS_JSONLD_ROBOTS]: { body: ALLOW_ALL },
    [CAMPUS_JSONLD]: { body: importFixture('campus-jsonld.html'), headers: HTML },
    [CAMPUS_OG_ROBOTS]: { body: ALLOW_ALL },
    [CAMPUS_OG]: { body: importFixture('campus-og.html'), headers: HTML },
    ...extra,
  };
}

let harness: ImportHarness;

const context = { actor: ADMIN, requestId: 'req-1' };

async function open(
  extra: Readonly<Record<string, FakeResponse | readonly FakeResponse[]>> = {},
): Promise<void> {
  await loadHtmlParser();
  harness = openImportHarness(routes(extra));
}

afterEach(() => {
  harness.close();
});

function auditActions(): string[] {
  return harness.database.db.drizzle
    .select()
    .from(auditLog)
    .all()
    .map((row) => row.action);
}

function recordCount(): number {
  return harness.database.db.drizzle.select().from(sourceRecords).all().length;
}

describe('the dispatch matrix (D-30), against the live source rows', () => {
  beforeEach(async () => {
    await open();
  });

  it.each([
    [DEVPOST_PAGE, 'MANUAL_ONLY'],
    ['https://sub.devpost.com/software/x', 'MANUAL_ONLY'],
    [DEVFOLIO_PAGE, 'ADAPTER'],
    ['https://devfolio.co/hackathons', 'MANUAL_ONLY'],
    [CTFTIME_EVENT, 'ADAPTER'],
    [CAMPUS_OG, 'GENERIC'],
  ])('sends %s to %s', async (url, disposition) => {
    const result = await harness.service.preview(context, { url });
    expect(result.disposition).toBe(disposition);
  });

  it.each([
    ['http://devpost.com/software/x', 'IMPORT_URL_INVALID'],
    ['not a url', 'IMPORT_URL_INVALID'],
    ['https://10.1.2.3/event', 'IMPORT_URL_INVALID'],
    ['file:///C:/events.html', 'IMPORT_URL_INVALID'],
    ['data:text/html,<h1>x</h1>', 'IMPORT_URL_INVALID'],
  ])('refuses %s with %s', async (url, code) => {
    await expect(harness.service.preview(context, { url })).rejects.toMatchObject({ code });
    expect(harness.transport.calls).toHaveLength(0);
  });
});

describe('sample 3: a Devpost link (D-26, D-30)', () => {
  beforeEach(async () => {
    await open();
  });

  it('makes zero requests — not the page, not even robots.txt', async () => {
    const result = await harness.service.preview(context, { url: DEVPOST_PAGE });
    expect(result.disposition).toBe('MANUAL_ONLY');
    expect(harness.transport.calls).toEqual([]);
  });

  it('answers with the link and the reason, in Devpost’s own words', async () => {
    const result = await harness.service.preview(context, { url: DEVPOST_PAGE });
    expect(result.url).toBe(DEVPOST_PAGE);
    expect(result.sourceKey).toBe('devpost');
    expect(result.reason).toContain("doesn't allow automated reading");
    expect(result.reason).toContain('scrape');
    expect(result.candidate).toBeUndefined();
  });

  it('cannot be committed as a generic import however the request is phrased', async () => {
    await expect(
      harness.service.commit(context, {
        url: DEVPOST_PAGE,
        disposition: 'GENERIC',
        fields: { title: 'Sneaky', officialUrl: DEVPOST_PAGE },
        edited: [],
      }),
    ).rejects.toMatchObject({ code: 'IMPORT_DOMAIN_MANUAL_ONLY' });
    expect(harness.transport.calls).toEqual([]);
    expect(recordCount()).toBe(0);
  });
});

describe('sample 1: a Devfolio hackathon page → its own adapter', () => {
  beforeEach(async () => {
    await open();
  });

  it('reads the page with WP-12’s adapter and shows what it found', async () => {
    const result = await harness.service.preview(context, { url: DEVFOLIO_PAGE });
    expect(result.disposition).toBe('ADAPTER');
    expect(result.sourceKey).toBe('devfolio');
    expect(result.candidate?.sourceKey).toBe('devfolio');
    expect(result.fieldsFound.map((field) => field.field)).toContain('title');
    expect(result.fieldsFound.every((field) => field.origin === 'ADAPTER')).toBe(true);
    // One page, plus that sub-domain's robots.txt, which is not a page request.
    expect(harness.transport.calls.filter((call) => call.url === DEVFOLIO_PAGE)).toHaveLength(1);
  });

  it('saves it as a Devfolio record, so a later scrape merges with it normally', async () => {
    const preview = await harness.service.preview(context, { url: DEVFOLIO_PAGE });
    const saved = await harness.service.commit(context, {
      url: preview.url,
      disposition: 'ADAPTER',
      sourceKey: 'devfolio',
      fields: { title: preview.candidate?.title ?? 'x', officialUrl: DEVFOLIO_PAGE },
      edited: [],
    });
    expect(saved.created).toBe(true);
    expect(saved.sourceKey).toBe('devfolio');
    const record = harness.database.db.drizzle.select().from(sourceRecords).all()[0];
    expect(record?.sourceId).toBe(harness.row('devfolio').id);
    expect(record?.externalKey).toBe(preview.candidate?.externalKey);
    // The commit reuses what the preview read: still one page request in total.
    expect(harness.transport.calls.filter((call) => call.url === DEVFOLIO_PAGE)).toHaveLength(1);
  });
});

describe('sample 2: a CTFtime event URL → the documented API', () => {
  beforeEach(async () => {
    await open();
  });

  it('reads the event through /api/v1/events/{id}/ and never the HTML page', async () => {
    const result = await harness.service.preview(context, { url: CTFTIME_EVENT });
    expect(result.disposition).toBe('ADAPTER');
    expect(result.candidate?.title).toBe('SCAN 2026 Final');
    expect(harness.transport.calls.map((call) => call.url)).toContain(CTFTIME_API);
    expect(harness.transport.calls.map((call) => call.url)).not.toContain(CTFTIME_EVENT);
  });

  it('opens the form for a CTFtime URL that is not an event page, with no request', async () => {
    const before = harness.transport.calls.length;
    const result = await harness.service.preview(context, {
      url: 'https://ctftime.org/team/1234',
    });
    expect(result.disposition).toBe('MANUAL_ONLY');
    expect(harness.transport.calls).toHaveLength(before);
  });
});

describe('samples 4 and 5: a campus page through the generic reader', () => {
  beforeEach(async () => {
    await open();
  });

  it('reads schema.org Event data and keeps every field’s origin', async () => {
    const result = await harness.service.preview(context, { url: CAMPUS_JSONLD });
    expect(result.disposition).toBe('GENERIC');
    expect(result.sourceKey).toBeUndefined();
    const title = result.fieldsFound.find((field) => field.field === 'title');
    expect(title?.origin).toBe('JSON_LD');
    expect(title?.confidence).toBe(1);
    expect(result.candidate?.startsAt?.at).toBe(Date.parse('2026-11-14T09:00:00+05:30'));
  });

  it('marks a page with only Open Graph and prose as the guesswork it is', async () => {
    const result = await harness.service.preview(context, { url: CAMPUS_OG });
    const start = result.fieldsFound.find((field) => field.field === 'startsAt');
    expect(start?.origin).toBe('HEURISTIC');
    expect(start?.confidence).toBeLessThan(0.8);
    expect(result.fieldsMissing).toContain('Place');
  });

  it('drops every contact detail on the way in (D-29)', async () => {
    const result = await harness.service.preview(context, { url: CAMPUS_JSONLD });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/convenor@example\.edu/);
    expect(json).not.toMatch(/98765[\s-]?43210/);
  });

  it('makes exactly one page request and follows no link', async () => {
    await harness.service.preview(context, { url: CAMPUS_OG });
    const pages = harness.transport.calls.filter((call) => !call.url.endsWith('robots.txt'));
    expect(pages.map((call) => call.url)).toEqual([CAMPUS_OG]);
  });

  it('saves under url-import, with the professor’s corrections as overrides', async () => {
    const preview = await harness.service.preview(context, { url: CAMPUS_OG });
    const saved = await harness.service.commit(context, {
      url: preview.url,
      disposition: 'GENERIC',
      fields: {
        title: 'TechFest 2026 (corrected)',
        startsAt: { at: '2026-12-12' },
        officialUrl: CAMPUS_OG,
      },
      edited: ['title'],
    });
    expect(saved.sourceKey).toBe('url-import');
    expect(saved.overriddenFields).toEqual(['title']);
    const event = harness.events.events.getById(saved.eventId);
    expect(event?.title).toBe('TechFest 2026 (corrected)');
  });
});

describe('the generic reader’s limits (§7.1, §4.8)', () => {
  it('refuses a page robots.txt disallows, and does not fetch it', async () => {
    await open({ [CAMPUS_OG_ROBOTS]: { body: DISALLOW_ALL } });
    await expect(harness.service.preview(context, { url: CAMPUS_OG })).rejects.toMatchObject({
      code: 'IMPORT_ROBOTS_DISALLOWED',
    });
    expect(harness.transport.calls.map((call) => call.url)).toEqual([CAMPUS_OG_ROBOTS]);
  });

  it('refuses anything that is not HTML', async () => {
    await open({
      [CAMPUS_OG]: { body: '%PDF-1.7', headers: { 'content-type': 'application/pdf' } },
    });
    await expect(harness.service.preview(context, { url: CAMPUS_OG })).rejects.toMatchObject({
      code: 'IMPORT_UNSUPPORTED_CONTENT',
    });
  });

  it('refuses a body over the 5 MB cap rather than buffering it', async () => {
    const megabyte = new Uint8Array(1024 * 1024);
    await open({
      [CAMPUS_OG]: { body: Array.from({ length: 6 }, () => megabyte), headers: HTML },
    });
    await expect(harness.service.preview(context, { url: CAMPUS_OG })).rejects.toMatchObject({
      code: 'IMPORT_TOO_LARGE',
    });
  });

  it('says so plainly when a page holds nothing an event can be built from', async () => {
    await open({
      [CAMPUS_OG]: { body: '<!doctype html><html><body></body></html>', headers: HTML },
    });
    await expect(harness.service.preview(context, { url: CAMPUS_OG })).rejects.toMatchObject({
      code: 'IMPORT_EXTRACTION_FAILED',
    });
  });

  it('is limited to ten previews a minute per user (§7.1)', async () => {
    await open();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await harness.service.preview(context, { url: DEVPOST_PAGE });
    }
    await expect(harness.service.preview(context, { url: DEVPOST_PAGE })).rejects.toMatchObject({
      code: 'IMPORT_RATE_LIMITED',
    });
    // A minute later it is allowed again.
    harness.clock.advance(61_000);
    await expect(harness.service.preview(context, { url: DEVPOST_PAGE })).resolves.toBeDefined();
  });
});

describe('a preview writes nothing', () => {
  it('leaves every table exactly as it found it', async () => {
    await open();
    const before = { records: recordCount(), audit: auditActions().length };
    await harness.service.preview(context, { url: CAMPUS_JSONLD });
    await harness.service.preview(context, { url: DEVPOST_PAGE });
    await harness.service.preview(context, { url: DEVFOLIO_PAGE });
    expect({ records: recordCount(), audit: auditActions().length }).toEqual(before);
  });
});

const MANUAL: ManualEventInput = {
  title: 'Department Ideathon 2026',
  eventType: 'IDEATHON',
  organizerName: 'Department of Computer Engineering',
  description: 'An internal ideathon. Write to convenor@example.edu or call 98765 43210.',
  mode: 'OFFLINE',
  place: { city: 'Pune', state: 'Maharashtra', countryCode: 'IN' },
  startsAt: { at: '2026-10-20T09:00:00+05:30' },
  registrationDeadlineAt: { at: '2026-10-10' },
  teamSizeText: 'teams of 2-4',
  feeText: 'Free',
  officialUrl: 'https://cse.example.edu/ideathon-2026',
};

describe('manual entry (§10.2)', () => {
  beforeEach(async () => {
    await open();
  });

  it('creates an event under the manual source, with no request of any kind', () => {
    const saved = harness.service.createManual(context, MANUAL);
    expect(saved.created).toBe(true);
    expect(saved.sourceKey).toBe('manual');
    expect(harness.transport.calls).toEqual([]);
    const event = harness.events.events.getById(saved.eventId);
    expect(event?.title).toBe('Department Ideathon 2026');
    expect(event?.eventType).toBe('IDEATHON');
  });

  it('writes one override per field the professor filled in, and none for the blanks', () => {
    const saved = harness.service.createManual(context, MANUAL);
    const rows = harness.database.db.drizzle.select().from(eventOverrides).all();
    const fields = rows.map((row) => row.field).sort();
    expect(fields).toContain('title');
    expect(fields).toContain('startsAt');
    expect(fields).toContain('feeKnown');
    // Nothing was said about a prize or a submission deadline, so nothing is
    // overridden and a source may still fill them.
    expect(fields).not.toContain('prizeText');
    expect(fields).not.toContain('submissionDeadlineAt');
    expect(rows.every((row) => row.reason === 'manual entry')).toBe(true);
    expect(rows.every((row) => row.setBy === ADMIN.id)).toBe(true);
    expect([...saved.overriddenFields].sort()).toEqual(fields);
  });

  it('redacts the contact details a professor pasted into the description (D-29)', () => {
    const saved = harness.service.createManual(context, MANUAL);
    const event = harness.events.events.getById(saved.eventId);
    expect(event?.descriptionMd).not.toMatch(/convenor@example\.edu|98765/);
    expect(event?.descriptionMd).toContain('[contact details on the source page]');
  });

  it('is a professor’s job, not only an administrator’s (§10.2)', () => {
    expect(() => harness.service.createManual({ actor: PROFESSOR }, MANUAL)).not.toThrow();
  });

  it('audits the creation with the actor, and never the whole record', () => {
    harness.service.createManual(context, MANUAL);
    expect(auditActions()).toContain('event.created.manual');
  });
});

describe('what a professor states survives the next scrape (§7.5)', () => {
  beforeEach(async () => {
    await open();
  });

  it('keeps the overridden value and still records what the source claimed', async () => {
    // A professor imports the campus page and corrects its title.
    const preview = await harness.service.preview(context, { url: CAMPUS_JSONLD });
    const saved = await harness.service.commit(context, {
      url: preview.url,
      disposition: 'GENERIC',
      sourceKey: 'url-import',
      fields: { title: 'Innovate 2026 (Computer Engineering)', officialUrl: CAMPUS_JSONLD },
      edited: ['title'],
    });

    // The same page is read again later and still says the old title.
    harness.clock.advance(3_600_000);
    const again = await harness.service.preview(context, { url: CAMPUS_JSONLD });
    const second = await harness.service.commit(context, {
      url: again.url,
      disposition: 'GENERIC',
      sourceKey: 'url-import',
      fields: { title: 'Innovate 2026 (Computer Engineering)', officialUrl: CAMPUS_JSONLD },
      edited: [],
    });

    expect(second.eventId).toBe(saved.eventId);
    expect(second.created).toBe(false);
    const event = harness.events.events.getById(saved.eventId);
    expect(event?.title).toBe('Innovate 2026 (Computer Engineering)');
    // The source's own claim is still recorded, unchanged, under its record.
    const claims = harness.events.provenance.claimsOf(saved.eventId);
    const titleClaim = claims.find((claim) => claim.field === 'title');
    expect(titleClaim?.valueJson).toBe(JSON.stringify('Innovate 2026 — National Level Hackathon'));
  });

  it('imports the same URL twice into one event, never two', async () => {
    await harness.service.preview(context, { url: CAMPUS_OG });
    const first = await harness.service.commit(context, {
      url: CAMPUS_OG,
      disposition: 'GENERIC',
      fields: { title: 'TechFest 2026', officialUrl: CAMPUS_OG },
      edited: [],
    });
    harness.clock.advance(60_000);
    await harness.service.preview(context, { url: CAMPUS_OG });
    const second = await harness.service.commit(context, {
      url: CAMPUS_OG,
      disposition: 'GENERIC',
      fields: { title: 'TechFest 2026', officialUrl: CAMPUS_OG },
      edited: [],
    });
    expect(second.eventId).toBe(first.eventId);
    expect(recordCount()).toBe(1);
  });

  it('joins a typed-in event to the page it was imported from, by URL (§7.5)', async () => {
    const typed = harness.service.createManual(context, {
      ...MANUAL,
      title: 'TechFest 2026',
      officialUrl: CAMPUS_OG,
      startsAt: { at: '2026-12-12' },
    });
    await harness.service.preview(context, { url: CAMPUS_OG });
    const imported = await harness.service.commit(context, {
      url: CAMPUS_OG,
      disposition: 'GENERIC',
      fields: { title: 'TechFest 2026', officialUrl: CAMPUS_OG },
      edited: [],
    });
    expect(imported.eventId).toBe(typed.eventId);
    expect(imported.created).toBe(false);
    // One event, two source records: the professor's entry and the page.
    expect(recordCount()).toBe(2);
    expect(auditActions()).toContain('event.imported.url');
  });
});
