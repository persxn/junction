import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CTFTIME_CAPTURE_CLOCK, openTestGeo, type TestGeo } from '../../testing/ctftime.js';
import { devfolioHtml, openHackathons, pagePropsOf, researchJson } from '../../testing/devfolio.js';
import { expectGolden } from '../../testing/golden.js';
import { AdapterRegistry, registerBuiltInAdapters } from '../../sources/registry.js';
import { extractDetail, extractListing, nextData, DevfolioFormatError } from './extract.js';
import { canonicalZone, mapDevfolio, type DevfolioMapContext } from './map.js';
import { DevfolioHackathon, DevfolioDetailPage } from './schema.js';

/** The pure half of WP-12: extraction and mapping over the recorded pages. */

let geo: TestGeo;
let ctx: DevfolioMapContext;

beforeAll(() => {
  geo = openTestGeo();
  ctx = { clock: CTFTIME_CAPTURE_CLOCK, sourceKey: 'devfolio', geo: geo.geocoder };
});

afterAll(() => {
  geo.close();
});

describe('the HTML fixtures embed the recorded payloads unchanged (R62)', () => {
  it('listing.html carries listing-hackathons.json and detail-recursiveacm.html carries detail-hackathon.json', () => {
    expect(pagePropsOf(devfolioHtml('listing.html'))).toEqual(
      researchJson('listing-hackathons.json'),
    );
    expect(pagePropsOf(devfolioHtml('detail-recursiveacm.html'))).toEqual(
      researchJson('detail-hackathon.json'),
    );
  });
});

describe('extraction', () => {
  it('reads __NEXT_DATA__ with cheerio and validates pageProps', () => {
    const listing = extractListing(devfolioHtml('listing.html'));
    expect(listing.open_hackathons).toHaveLength(5);
    expect(extractDetail(devfolioHtml('detail-recursiveacm.html')).hackathon.slug).toBe(
      'recursiveacm',
    );
  });

  it('a missing script, broken JSON or renamed buckets are format errors, never silence', () => {
    expect(() => nextData('<html><body>no data</body></html>')).toThrow(DevfolioFormatError);
    expect(() =>
      nextData('<script id="__NEXT_DATA__" type="application/json">{not json</script>'),
    ).toThrow(DevfolioFormatError);
    expect(() => extractListing(devfolioHtml('detail-schema-changed.html'))).toThrow(
      /documented shape/,
    );
    expect(extractListing(devfolioHtml('listing-empty.html')).open_hackathons).toEqual([]);
  });
});

describe('goldens', () => {
  it('maps the recorded listing (open + upcoming) one candidate per hackathon', () => {
    const listing = extractListing(devfolioHtml('listing.html'));
    expectGolden(
      'devfolio/listing.candidates',
      [...listing.open_hackathons, ...listing.upcoming_hackathons].map((hackathon) =>
        mapDevfolio({ kind: 'listing', hackathon }, ctx),
      ),
    );
  });

  it('maps the recorded detail page', () => {
    const page = extractDetail(devfolioHtml('detail-recursiveacm.html'));
    expectGolden(
      'devfolio/detail-recursiveacm.candidate',
      mapDevfolio({ kind: 'detail', page }, ctx),
    );
  });
});

describe('field mapping', () => {
  const base = () => DevfolioHackathon.parse(openHackathons()[0]);

  it('mode: online / hybrid / offline', () => {
    const online = mapDevfolio({ kind: 'listing', hackathon: { ...base(), is_online: true } }, ctx);
    expect(online.mode.value).toBe('ONLINE');
    const hybrid = mapDevfolio(
      {
        kind: 'listing',
        hackathon: {
          ...base(),
          is_online: false,
          settings: { ...base().settings, is_hybrid: true },
        },
      },
      ctx,
    );
    expect(hybrid.mode.value).toBe('HYBRID');
    const offline = mapDevfolio(
      { kind: 'listing', hackathon: { ...base(), is_online: false } },
      ctx,
    );
    expect(offline.mode.value).toBe('OFFLINE');
  });

  it('fee: paid=false is a known zero; paid=true is unknown with the original text; absent is unknown', () => {
    const page = DevfolioDetailPage.parse(researchJson('detail-hackathon.json'));
    const free = mapDevfolio({ kind: 'detail', page }, ctx);
    expect(free.fee).toMatchObject({ known: true, minor: 0, currency: 'INR' });
    const paidPage = {
      ...page,
      hackathon: { ...page.hackathon, settings: { ...page.hackathon.settings, paid: true } },
    };
    const paid = mapDevfolio({ kind: 'detail', page: paidPage }, ctx);
    expect(paid.fee).toEqual({
      known: false,
      text: 'Paid — the amount is not stated on Devfolio',
      confidence: 0,
    });
    expect(mapDevfolio({ kind: 'listing', hackathon: base() }, ctx).fee).toEqual({
      known: false,
      confidence: 0,
    });
  });

  it('Asia/Calcutta is recorded as Asia/Kolkata', () => {
    expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(mapDevfolio({ kind: 'listing', hackathon: base() }, ctx).timezone).toBe('Asia/Kolkata');
  });

  it('team size and place come from the detail; the registration URL is the subdomain', () => {
    const page = DevfolioDetailPage.parse(researchJson('detail-hackathon.json'));
    const candidate = mapDevfolio({ kind: 'detail', page }, ctx);
    expect(candidate.teamSize).toEqual({ min: 2, max: 4, confidence: 1 });
    expect(candidate.registrationUrl).toBe('https://recursiveacm.devfolio.co/');
    expect(candidate.officialUrl).toBe('https://www.recursiveacm.in/');
    expect(candidate.externalKey).toBe('devfolio:72aac6f9ba9f4fc6b24fe9bfe979acaf');
    expect(candidate.eventType.value).toBe('HACKATHON');
    expect(candidate.place?.venueName).toMatch(/Guru Nanak Institute of Technology/);
  });

  it('organizer is never invented: unknown on the listing, a low-confidence institution match at most', () => {
    expect(mapDevfolio({ kind: 'listing', hackathon: base() }, ctx).organizerName).toBeUndefined();
    const page = DevfolioDetailPage.parse(researchJson('detail-hackathon.json'));
    const kind = mapDevfolio({ kind: 'detail', page }, ctx).organizerKind;
    if (kind !== undefined) {
      expect(kind.confidence).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('R22', () => {
  it('registers the devfolio adapter exactly once', () => {
    const registry = new AdapterRegistry();
    registerBuiltInAdapters(registry, {
      geo: {
        resolve: () => ({ geoPrecision: 'UNKNOWN', warnings: [] }),
        institutionNamed: () => undefined,
      },
    });
    expect(registry.all().filter((adapter) => adapter.key === 'devfolio')).toHaveLength(1);
  });
});
