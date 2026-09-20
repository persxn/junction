import {
  DEFAULT_EVENT_TYPE_POLICY,
  DEFAULT_GEOGRAPHY_POLICY,
  POLICY_LABELS,
  POLICY_LABEL_TEXT,
  POLICY_REASONS,
  PolicyVerdict,
} from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import { applyEventTypePolicy } from './event-type.js';
import { applyGeographyPolicy } from './geography.js';
import { applyPolicies } from './index.js';

/**
 * The two visibility policies (§7.4, D-31, ruling R57).
 *
 * Pure functions over facts, so every case is one line and the whole policy
 * reads as a table. The cases that matter most are the ones where an event is
 * *kept*: hiding too much is the failure a professor never notices.
 */

const geography = DEFAULT_GEOGRAPHY_POLICY;
const eventType = DEFAULT_EVENT_TYPE_POLICY;
const policies = { geography, eventType };

describe('the geography policy', () => {
  it('keeps an in-person event inside the allowed countries', () => {
    expect(applyGeographyPolicy({ mode: 'OFFLINE', countryCode: 'IN' }, geography)).toStrictEqual({
      visibility: 'VISIBLE',
    });
  });

  it('hides an in-person event outside them, with a reason', () => {
    expect(applyGeographyPolicy({ mode: 'OFFLINE', countryCode: 'KR' }, geography)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES',
    });
  });

  it('keeps every online event, wherever it nominally is', () => {
    for (const countryCode of ['IN', 'KR', 'US', undefined]) {
      expect(
        applyGeographyPolicy({ mode: 'ONLINE', countryCode }, geography).visibility,
        countryCode,
      ).toBe('VISIBLE');
    }
  });

  it('can be told to restrict online events too', () => {
    const restricted = { ...geography, online: { allow: 'ALLOWED_COUNTRIES' as const } };
    expect(applyGeographyPolicy({ mode: 'ONLINE', countryCode: 'IN' }, restricted).visibility).toBe(
      'VISIBLE',
    );
    expect(applyGeographyPolicy({ mode: 'ONLINE', countryCode: 'KR' }, restricted)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'ONLINE_OUTSIDE_ALLOWED_COUNTRIES',
    });
  });

  /** Q12, still open — which is why this is a setting and not a constant. */
  it('shows a hybrid event abroad as an online opportunity, by default', () => {
    expect(applyGeographyPolicy({ mode: 'HYBRID', countryCode: 'KR' }, geography)).toStrictEqual({
      visibility: 'VISIBLE',
      label: 'HYBRID_ONLINE_PARTICIPATION',
    });
  });

  it('hides it instead when configured to', () => {
    const strict = {
      ...geography,
      hybrid: { ...geography.hybrid, ifOutsideAllowed: 'HIDE' as const },
    };
    expect(applyGeographyPolicy({ mode: 'HYBRID', countryCode: 'KR' }, strict)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'HYBRID_OUTSIDE_ALLOWED_COUNTRIES',
    });
  });

  it('keeps a hybrid event at home with no badge at all', () => {
    expect(applyGeographyPolicy({ mode: 'HYBRID', countryCode: 'IN' }, geography)).toStrictEqual({
      visibility: 'VISIBLE',
    });
  });

  it('judges a hybrid event as online when told to', () => {
    const asOnline = {
      ...geography,
      hybrid: { ...geography.hybrid, evaluate: 'ONLINE' as const },
    };
    expect(applyGeographyPolicy({ mode: 'HYBRID', countryCode: 'KR' }, asOnline).visibility).toBe(
      'VISIBLE',
    );
  });

  /** §6.1: unknown is not false. An unresolved location is shown, flagged. */
  it('shows an event whose location is unknown, with a flag', () => {
    expect(applyGeographyPolicy({ mode: 'OFFLINE' }, geography)).toStrictEqual({
      visibility: 'VISIBLE',
      label: 'LOCATION_UNKNOWN',
    });
    expect(applyGeographyPolicy({ mode: 'UNKNOWN' }, geography).visibility).toBe('VISIBLE');
  });

  it('hides it only when explicitly configured to', () => {
    const strict = { ...geography, unknownLocation: 'HIDE' as const };
    expect(applyGeographyPolicy({ mode: 'OFFLINE' }, strict)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'LOCATION_UNKNOWN',
    });
  });

  it('treats an UNKNOWN mode with a known country as physical', () => {
    expect(applyGeographyPolicy({ mode: 'UNKNOWN', countryCode: 'KR' }, geography)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES',
    });
  });

  it('is case-insensitive about the country code', () => {
    expect(applyGeographyPolicy({ mode: 'OFFLINE', countryCode: 'in' }, geography).visibility).toBe(
      'VISIBLE',
    );
  });
});

describe('the event-type policy (D-31)', () => {
  it('keeps every in-scope type', () => {
    for (const type of eventType.allowedTypes) {
      expect(applyEventTypePolicy({ eventType: type }, eventType).visibility, type).toBe('VISIBLE');
    }
  });

  it('hides a confidently out-of-scope event', () => {
    expect(applyEventTypePolicy({ eventType: 'OTHER', confidence: 1 }, eventType)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'EVENT_TYPE_OUT_OF_SCOPE',
    });
  });

  /** "We could not classify it" is not the same as "it is out of scope". */
  it('shows an unclassifiable event, flagged', () => {
    expect(applyEventTypePolicy({ eventType: 'OTHER', confidence: 0.4 }, eventType)).toStrictEqual({
      visibility: 'VISIBLE',
      label: 'EVENT_TYPE_UNKNOWN',
    });
  });

  it('hides it when configured to', () => {
    const strict = { ...eventType, unknownType: 'HIDE' as const };
    expect(applyEventTypePolicy({ eventType: 'OTHER', confidence: 0.4 }, strict)).toStrictEqual({
      visibility: 'POLICY_HIDDEN',
      reason: 'EVENT_TYPE_UNKNOWN',
    });
  });
});

describe('applyPolicies runs type first, so policy_reason is stable', () => {
  it('reports the type as the reason when an event fails both', () => {
    const decision = applyPolicies(
      { mode: 'OFFLINE', countryCode: 'KR', eventType: 'OTHER', confidence: 1 },
      policies,
    );
    expect(decision.visibility).toBe('POLICY_HIDDEN');
    // Out of scope whatever the geography policy says, so that is the reason.
    expect(decision.reason).toBe('EVENT_TYPE_OUT_OF_SCOPE');
  });

  it('collects every caveat on an event it keeps', () => {
    const decision = applyPolicies(
      { mode: 'HYBRID', countryCode: 'KR', eventType: 'OTHER', confidence: 0.3 },
      policies,
    );
    expect(decision.visibility).toBe('VISIBLE');
    expect(decision.labels).toStrictEqual(['EVENT_TYPE_UNKNOWN', 'HYBRID_ONLINE_PARTICIPATION']);
    expect(decision.label).toBe('EVENT_TYPE_UNKNOWN');
  });

  it('keeps a plain Indian hackathon with no caveats at all', () => {
    const decision = applyPolicies(
      { mode: 'OFFLINE', countryCode: 'IN', eventType: 'HACKATHON', confidence: 1 },
      policies,
    );
    expect(decision.visibility).toBe('VISIBLE');
    expect(decision.labels).toStrictEqual([]);
    expect(decision.reason).toBeUndefined();
  });
});

describe('the contracts the policies are written against', () => {
  it('defaults deserialize to §7.4 exactly', () => {
    expect(DEFAULT_GEOGRAPHY_POLICY).toStrictEqual({
      inPerson: { allowCountries: ['IN'] },
      online: { allow: 'ALL' },
      hybrid: { evaluate: 'PHYSICAL_LOCATION', ifOutsideAllowed: 'SHOW_AS_ONLINE' },
      unknownLocation: 'SHOW_FLAGGED',
    });
    expect(DEFAULT_EVENT_TYPE_POLICY.allowedTypes).toStrictEqual([
      'HACKATHON',
      'IDEATHON',
      'INNOVATION_CHALLENGE',
      'CTF',
      'CODING_CONTEST',
    ]);
  });

  it('every reason a policy can produce is in the contracts enum', () => {
    const strictest = {
      eventType: { ...eventType, unknownType: 'HIDE' as const },
      geography: {
        ...geography,
        unknownLocation: 'HIDE' as const,
        online: { allow: 'ALLOWED_COUNTRIES' as const },
        hybrid: { ...geography.hybrid, ifOutsideAllowed: 'HIDE' as const },
      },
    };
    const produced = new Set<string>();
    for (const mode of ['ONLINE', 'OFFLINE', 'HYBRID', 'UNKNOWN'] as const) {
      for (const countryCode of ['IN', 'KR', undefined]) {
        for (const strictness of [policies, strictest]) {
          for (const type of ['HACKATHON', 'OTHER'] as const) {
            const decision = applyPolicies(
              { mode, countryCode, eventType: type, confidence: 0.3 },
              strictness,
            );
            if (decision.reason !== undefined) {
              produced.add(decision.reason);
            }
          }
        }
      }
    }
    expect(produced.size).toBeGreaterThan(3);
    for (const reason of produced) {
      expect(POLICY_REASONS, reason).toContain(reason);
    }
  });

  it('a verdict cannot be hidden without a reason, or visible with one', () => {
    expect(PolicyVerdict.safeParse({ visibility: 'POLICY_HIDDEN' }).success).toBe(false);
    expect(
      PolicyVerdict.safeParse({ visibility: 'VISIBLE', reason: 'LOCATION_UNKNOWN' }).success,
    ).toBe(false);
    expect(PolicyVerdict.safeParse({ visibility: 'VISIBLE' }).success).toBe(true);
  });

  it('a policy can only make an event VISIBLE or POLICY_HIDDEN', () => {
    expect(PolicyVerdict.safeParse({ visibility: 'ADMIN_HIDDEN' }).success).toBe(false);
    expect(PolicyVerdict.safeParse({ visibility: 'MERGED' }).success).toBe(false);
  });

  it('every label has wording, so the UI cannot invent its own', () => {
    for (const label of POLICY_LABELS) {
      expect(POLICY_LABEL_TEXT[label].length, label).toBeGreaterThan(0);
    }
    expect(POLICY_LABEL_TEXT.HYBRID_ONLINE_PARTICIPATION).toBe('Hybrid — online participation');
  });
});
