import { EventCandidate } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REDACTED, hasContactDetails } from '../../domain/normalize/index.js';
import {
  CTFTIME_CAPTURE_CLOCK,
  ctftimeFixture,
  openTestGeo,
  type TestGeo,
} from '../../testing/ctftime.js';
import { expectGolden } from '../../testing/golden.js';
import { mapCtftimeEvent, type CtftimeMapContext } from './map.js';
import { CTFTIME_BASE_URL } from './paths.js';
import { CtftimeEvent, CtftimeListing } from './schema.js';

/**
 * The CTFtime mapping (`source-feasibility.md` §1.5), over the recorded WP-02
 * payloads and the two hand-written cases. The goldens hold the full
 * `EventCandidate` per item and were read by eye when they were recorded.
 */

let geo: TestGeo;
let ctx: CtftimeMapContext;

beforeAll(() => {
  geo = openTestGeo();
  ctx = {
    clock: CTFTIME_CAPTURE_CLOCK,
    sourceKey: 'ctftime',
    origin: CTFTIME_BASE_URL,
    geo: geo.geocoder,
  };
});

afterAll(() => {
  geo.close();
});

function listing(name: string): CtftimeEvent[] {
  return CtftimeListing.parse(ctftimeFixture(name));
}

function byId(events: readonly CtftimeEvent[], id: number): CtftimeEvent {
  const found = events.find((event) => event.id === id);
  if (found === undefined) {
    throw new Error(`fixture has no event ${String(id)}`);
  }
  return found;
}

/**
 * Every string in a candidate, one per line. Numbers are left out on purpose: a
 * millisecond timestamp is thirteen digits and looks like a phone number to any
 * pattern that should catch one.
 */
function stringsOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stringsOf).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).map(stringsOf).join('\n');
  }
  return '';
}

const recorded = (): CtftimeEvent[] => [
  ...listing('listing-events.json'),
  CtftimeEvent.parse(ctftimeFixture('detail-event-3417.json')),
];

describe('goldens (R62: recorded on purpose, never refreshed to pass)', () => {
  it('maps the recorded listing, one candidate per event', () => {
    const events = listing('listing-events.json');
    expect(events).toHaveLength(5);
    expectGolden(
      'ctftime/listing-events.candidates',
      events.map((event) => mapCtftimeEvent(event, ctx)),
    );
  });

  it('maps the recorded detail 3417', () => {
    const event = CtftimeEvent.parse(ctftimeFixture('detail-event-3417.json'));
    expectGolden('ctftime/detail-event-3417.candidate', mapCtftimeEvent(event, ctx));
  });
});

describe('what every CTFtime candidate says', () => {
  it.each(recorded().map((event) => [event.id, event] as const))(
    'event %i: CTF, 2026, fee unknown, team unknown, valid',
    (_id, event) => {
      const candidate = mapCtftimeEvent(event, ctx);
      expect(EventCandidate.safeParse(candidate).success).toBe(true);
      expect(candidate.eventType).toEqual({ value: 'CTF', confidence: 1, raw: 'CTFtime' });
      expect(candidate.editionYear).toBe(2026);
      expect(candidate.fee).toEqual({ known: false, confidence: 0 });
      expect(candidate.teamSize).toBeUndefined();
      expect(candidate.startsAt?.precision).toBe('DATETIME');
      expect(candidate.endsAt?.precision).toBe('DATETIME');
    },
  );

  it('never carries the dropped fields, under any name', () => {
    for (const event of recorded()) {
      const json = JSON.stringify(mapCtftimeEvent(event, ctx));
      for (const key of ['participants', 'weight', 'logo', 'live_feed', 'votable', 'format_id']) {
        expect(json, `${String(event.id)} leaked ${key}`).not.toContain(`"${key}`);
      }
    }
  });

  it('builds the record URL from the id, and keeps url/ctftime_url as links', () => {
    const candidate = mapCtftimeEvent(byId(listing('listing-events.json'), 3312), ctx);
    expect(candidate.url).toBe('https://ctftime.org/event/3312/');
    expect(candidate.officialUrl).toBe('https://2026.faustctf.net/');
    expect(candidate.registrationUrl).toBe('https://ctftime.org/event/3312/');
    expect(candidate.organizerName).toBe('FAUST');
    expect(candidate.organizerKind).toEqual({ value: 'COMMUNITY', confidence: 0.7, raw: 'FAUST' });
  });
});

describe('mode and place', () => {
  it('3417 (onsite, "Seoul, Korea") is OFFLINE with a geocoded city and its zone', () => {
    const candidate = mapCtftimeEvent(
      CtftimeEvent.parse(ctftimeFixture('detail-event-3417.json')),
      ctx,
    );
    expect(candidate.mode).toEqual({ value: 'OFFLINE', confidence: 1, raw: 'offline' });
    expect(candidate.place).toMatchObject({
      city: 'Seoul',
      countryCode: 'KR',
      geoPrecision: 'CITY',
    });
    expect(candidate.place?.lat).toBeCloseTo(37.566, 2);
    expect(candidate.timezone).toBe('Asia/Seoul');
    expect(candidate.warnings.map((warning) => warning.code)).not.toContain('TIMEZONE_ASSUMED');
  });

  it('an online event with an empty location is ONLINE with no place and no country', () => {
    const candidate = mapCtftimeEvent(byId(listing('listing-events.json'), 3312), ctx);
    expect(candidate.mode.value).toBe('ONLINE');
    expect(candidate.place).toBeUndefined();
    expect(candidate.timezone).toBeUndefined();
    expect(candidate.warnings.map((warning) => warning.code)).toContain('TIMEZONE_ASSUMED');
  });

  it('an online event\'s location ("USA only") is eligibility text, not a venue', () => {
    const candidate = mapCtftimeEvent(byId(listing('listing-events.json'), 3422), ctx);
    expect(candidate.mode.value).toBe('ONLINE');
    expect(candidate.place).toBeUndefined();
    expect(candidate.eligibilityText).toBe('High-school. Location stated by the source: USA only');
  });

  it('an onsite city the gazetteer cannot place stays as stated, precision UNKNOWN', () => {
    const event = { ...byId(listing('listing-events.json'), 3312), onsite: true };
    const candidate = mapCtftimeEvent({ ...event, location: 'Atlantis' }, ctx);
    expect(candidate.mode.value).toBe('OFFLINE');
    expect(candidate.place).toEqual({ city: 'Atlantis', geoPrecision: 'UNKNOWN' });
  });
});

describe('prizes (R63): a second claim, never a conversion', () => {
  it('"$500" in prizes against "₹50,000" in the description', () => {
    const candidate = mapCtftimeEvent(byId(listing('listing-events.json'), 3435), ctx);
    expect(candidate.prize).toEqual({
      text: '1st Place - $500\r\n2nd Place - $300\r\n3rd Place - $200\r\nAdditional vouchers and rewards',
    });
    expect(candidate.prize?.totalMinor).toBeUndefined();
    expect(candidate.alternateClaims).toEqual([
      {
        field: 'prizeText',
        value: '1st — ₹50,000\n2nd — ₹30,000\n3rd — ₹20,000',
        sourceText: '1st — ₹50,000\n2nd — ₹30,000\n3rd — ₹20,000',
        note:
          'The description states prize figures (INR) that differ from the structured prizes field (USD); ' +
          'the structured field is used and nothing was converted.',
      },
    ]);
  });

  it('"2 BTC" stays text with no numeric total', () => {
    const candidate = mapCtftimeEvent(
      CtftimeEvent.parse(ctftimeFixture('detail-event-3417.json')),
      ctx,
    );
    expect(candidate.prize?.text).toMatch(/^Total Prize Pool: 2 BTC/);
    expect(candidate.prize?.totalMinor).toBeUndefined();
    expect(candidate.prize?.currency).toBeUndefined();
    expect(candidate.alternateClaims).toBeUndefined();
  });

  it('a ticket "valued at USD 400" is not a prize total', () => {
    const candidate = mapCtftimeEvent(byId(listing('listing-events.json'), 3374), ctx);
    expect(candidate.prize?.totalMinor).toBeUndefined();
  });

  it('an unambiguous single-currency total is read, and only that', () => {
    const base = byId(listing('listing-events.json'), 3312);
    expect(mapCtftimeEvent({ ...base, prizes: 'Total prize pool: $1,500' }, ctx).prize).toEqual({
      text: 'Total prize pool: $1,500',
      totalMinor: 150_000,
      currency: 'USD',
    });
    expect(mapCtftimeEvent({ ...base, prizes: '₹10,000' }, ctx).prize).toMatchObject({
      totalMinor: 1_000_000,
      currency: 'INR',
    });
    expect(mapCtftimeEvent({ ...base, prizes: 'TBD' }, ctx).prize).toEqual({ text: 'TBD' });
    expect(mapCtftimeEvent({ ...base, prizes: '' }, ctx).prize).toBeUndefined();
  });
});

describe('eligibility flags (R51)', () => {
  it('"Open" sets no flag', () => {
    expect(
      mapCtftimeEvent(byId(listing('listing-events.json'), 3312), ctx).eligibility,
    ).toBeUndefined();
  });

  it('"High-school" closes it to university students, with a confidence', () => {
    const { eligibility } = mapCtftimeEvent(byId(listing('listing-events.json'), 3422), ctx);
    expect(eligibility?.undergraduate).toEqual({
      value: false,
      confidence: 0.9,
      raw: 'High-school',
    });
    expect(eligibility?.postgraduate?.value).toBe(false);
  });

  it('"Prequalified" says only qualified teams may enter', () => {
    const { eligibility } = mapCtftimeEvent(
      CtftimeEvent.parse(ctftimeFixture('detail-event-3417.json')),
      ctx,
    );
    expect(eligibility).toEqual({
      qualifiedOnly: { value: true, confidence: 1, raw: 'Prequalified' },
    });
  });
});

describe('dates', () => {
  it('finish before start drops both with a warning, never guessed', () => {
    const [backwards] = listing('invalid-dates.json');
    const candidate = mapCtftimeEvent(backwards!, ctx);
    expect(candidate.startsAt).toBeUndefined();
    expect(candidate.endsAt).toBeUndefined();
    expect(candidate.warnings.map((warning) => warning.code)).toContain('DATE_RANGE_INVALID');
  });

  it('a duration that disagrees by an hour or more keeps the timestamps and warns', () => {
    const base = byId(listing('listing-events.json'), 3312);
    const candidate = mapCtftimeEvent({ ...base, duration: { days: 1, hours: 0 } }, ctx);
    expect(candidate.startsAt?.at).toBe(Date.parse('2026-09-26T12:00:00Z'));
    expect(candidate.endsAt?.at).toBe(Date.parse('2026-09-26T21:00:00Z'));
    expect(candidate.warnings.map((warning) => warning.code)).toContain('DATE_DURATION_MISMATCH');
  });

  it("CTFtime's whole-hour rounding (2 d 7 h for 2 d 7.5 h) is not a mismatch", () => {
    const candidate = mapCtftimeEvent(byId(listing('listing-events.json'), 3422), ctx);
    expect(candidate.warnings.map((warning) => warning.code)).not.toContain(
      'DATE_DURATION_MISMATCH',
    );
  });
});

describe('PII (D-29)', () => {
  it('the hand-written description shows the placeholder, and no contact survives', () => {
    const [event] = listing('pii-description.json');
    const candidate = mapCtftimeEvent(event!, ctx);
    expect(candidate.descriptionMd).toContain(REDACTED);
    expect(candidate.summary).toContain(REDACTED);
    expect(candidate.prize?.text).toContain(REDACTED);
    expect(hasContactDetails(stringsOf(candidate))).toBe(false);
    expect(candidate.warnings.map((warning) => warning.code)).toContain('PII_REDACTED');
  });

  it('no e-mail or phone pattern survives any normalized fixture output', () => {
    const all = [
      ...recorded(),
      ...listing('pii-description.json'),
      ...listing('invalid-dates.json'),
    ];
    for (const event of all) {
      const text = stringsOf(mapCtftimeEvent(event, ctx));
      expect(hasContactDetails(text), String(event.id)).toBe(false);
    }
  });
});
