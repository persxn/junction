import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EventCandidate,
  PARSE_WARNING_CODES,
  ParseWarning,
  uncertain,
  type EventCandidate as EventCandidateType,
} from './event-candidate.js';

/**
 * The contract that enforces D-29 and R50 at the schema level.
 *
 * These are not "we remember to filter people out" tests — they are "there is
 * nowhere to put a person" tests, which is a much stronger guarantee and the one
 * the spec actually asks for.
 */

const MINIMAL: EventCandidateType = {
  sourceKey: 'testsource',
  externalKey: 'e-1',
  url: 'https://example.org/e/1',
  title: 'Example',
  titleRaw: 'Example',
  eventType: { value: 'HACKATHON', confidence: 1 },
  mode: { value: 'UNKNOWN', confidence: 1 },
  isRecurringRound: false,
  warnings: [],
};

describe('EventCandidate has no people (R50, D-29)', () => {
  it.each([
    'contactEmail',
    'organizerEmail',
    'participants',
    'judges',
    'mentors',
    'contacts',
    'phone',
  ])('refuses a %s field rather than dropping it', (field) => {
    const result = EventCandidate.safeParse({ ...MINIMAL, [field]: 'anything' });
    expect(result.success).toBe(false);
  });

  it('refuses any unrecognised field, so a renamed one fails loudly', () => {
    expect(EventCandidate.safeParse({ ...MINIMAL, startsAtt: 1 }).success).toBe(false);
  });

  it('accepts the minimal candidate an empty record produces', () => {
    expect(EventCandidate.safeParse(MINIMAL).success).toBe(true);
  });

  it('is strict inside nested objects too', () => {
    const withExtra = {
      ...MINIMAL,
      place: { city: 'Mumbai', organiserPhone: '+91 98765 43210' },
    };
    expect(EventCandidate.safeParse(withExtra).success).toBe(false);
  });
});

describe('uncertain() (R51)', () => {
  const Wrapped = uncertain(z.string());

  it('carries a value, a confidence and the raw text', () => {
    const parsed = Wrapped.parse({ value: 'x', confidence: 0.8, raw: 'X!' });
    expect(parsed).toStrictEqual({ value: 'x', confidence: 0.8, raw: 'X!' });
  });

  it('rejects a confidence outside 0–1', () => {
    expect(Wrapped.safeParse({ value: 'x', confidence: 1.1 }).success).toBe(false);
    expect(Wrapped.safeParse({ value: 'x', confidence: -0.1 }).success).toBe(false);
  });

  it('accepts both ends of the range', () => {
    expect(Wrapped.safeParse({ value: 'x', confidence: 0 }).success).toBe(true);
    expect(Wrapped.safeParse({ value: 'x', confidence: 1 }).success).toBe(true);
  });

  it('requires a confidence: an uncertain value cannot pretend to be certain', () => {
    expect(Wrapped.safeParse({ value: 'x' }).success).toBe(false);
  });

  it('makes raw optional but rejects an unknown extra key', () => {
    expect(Wrapped.safeParse({ value: 'x', confidence: 1 }).success).toBe(true);
    expect(Wrapped.safeParse({ value: 'x', confidence: 1, note: 'hi' }).success).toBe(false);
  });
});

describe('the field invariants', () => {
  it('refuses a known fee with no amount', () => {
    const result = EventCandidate.safeParse({
      ...MINIMAL,
      fee: { known: true, confidence: 1 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a known fee of zero, because free is a price', () => {
    const result = EventCandidate.safeParse({
      ...MINIMAL,
      fee: { known: true, minor: 0, currency: 'INR', confidence: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('refuses a team size whose minimum exceeds its maximum', () => {
    expect(
      EventCandidate.safeParse({ ...MINIMAL, teamSize: { min: 5, max: 2, confidence: 1 } }).success,
    ).toBe(false);
  });

  it('refuses a prize total with no currency', () => {
    expect(EventCandidate.safeParse({ ...MINIMAL, prize: { totalMinor: 100 } }).success).toBe(
      false,
    );
  });

  it('refuses a summary longer than the column allows', () => {
    expect(EventCandidate.safeParse({ ...MINIMAL, summary: 'x'.repeat(501) }).success).toBe(false);
  });

  it('refuses a non-URL for url, officialUrl and registrationUrl', () => {
    for (const field of ['url', 'officialUrl', 'registrationUrl']) {
      expect(EventCandidate.safeParse({ ...MINIMAL, [field]: 'not a url' }).success, field).toBe(
        false,
      );
    }
  });

  it('refuses coordinates outside the globe', () => {
    expect(EventCandidate.safeParse({ ...MINIMAL, place: { lat: 91 } }).success).toBe(false);
    expect(EventCandidate.safeParse({ ...MINIMAL, place: { lon: -181 } }).success).toBe(false);
  });

  it('refuses a lower-case country code', () => {
    expect(EventCandidate.safeParse({ ...MINIMAL, place: { countryCode: 'in' } }).success).toBe(
      false,
    );
  });

  it('refuses an edition year outside 2020–2100', () => {
    expect(EventCandidate.safeParse({ ...MINIMAL, editionYear: 1999 }).success).toBe(false);
    expect(EventCandidate.safeParse({ ...MINIMAL, editionYear: 2101 }).success).toBe(false);
  });
});

describe('ParseWarning', () => {
  it('holds only registered codes', () => {
    expect(ParseWarning.safeParse({ code: 'NOT_A_CODE', message: 'x' }).success).toBe(false);
  });

  it('requires a message a professor can read', () => {
    expect(ParseWarning.safeParse({ code: 'DATE_UNPARSEABLE', message: '' }).success).toBe(false);
  });

  it('names every code in SCREAMING_SNAKE, uniquely', () => {
    expect(new Set(PARSE_WARNING_CODES).size).toBe(PARSE_WARNING_CODES.length);
    for (const code of PARSE_WARNING_CODES) {
      expect(code, code).toMatch(/^[A-Z]+(_[A-Z0-9]+)*$/);
    }
  });
});
