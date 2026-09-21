import type { OverrideField } from '@compintel/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { FIELD_GROUPS, resolve, type ResolvableClaim, type ResolvableOverride } from './resolve.js';

/** §7.5's field resolution: override > trust > recency, and nothing invented. */

let next = 0;
function claim(
  overrides: Partial<ResolvableClaim> & Pick<ResolvableClaim, 'field'>,
): ResolvableClaim {
  next += 1;
  return {
    id: `c${String(next)}`,
    valueJson: null,
    sourceRecordId: `r-${overrides.sourceKey ?? 'x'}`,
    sourceKey: 'x',
    trustRank: 40,
    observedAt: 1000,
    isAlternate: false,
    note: null,
    ...overrides,
  };
}

const T0 = Date.parse('2026-10-10T04:30:00Z');
const MINUTE = 60_000;

describe('precedence', () => {
  const claims = [
    claim({ field: 'title', valueJson: '"From the site"', sourceKey: 'site', trustRank: 80 }),
    claim({ field: 'title', valueJson: '"From Devfolio"', sourceKey: 'devfolio', trustRank: 60 }),
  ];

  it('the highest trust_rank wins', () => {
    expect(resolve(claims, []).fields.get('title')?.valueJson).toBe('"From the site"');
  });

  it('an active override beats a higher-trust source, and a cleared one falls back', () => {
    const live: ResolvableOverride = { field: 'title', valueJson: '"Corrected"', clearedAt: null };
    expect(resolve(claims, [live]).fields.get('title')).toMatchObject({
      valueJson: '"Corrected"',
      from: 'OVERRIDE',
    });
    const cleared = { ...live, clearedAt: 5 };
    expect(resolve(claims, [cleared]).fields.get('title')).toMatchObject({
      valueJson: '"From the site"',
      from: 'CLAIM',
    });
  });

  it('equal trust goes to the most recent observation', () => {
    const tied = [
      claim({ field: 'title', valueJson: '"Old"', sourceKey: 'a', observedAt: 1 }),
      claim({ field: 'title', valueJson: '"New"', sourceKey: 'b', observedAt: 2 }),
    ];
    expect(resolve(tied, []).fields.get('title')?.valueJson).toBe('"New"');
  });

  it('a source that says nothing does not outvote one that says something', () => {
    const quiet = [
      claim({ field: 'teamMax', valueJson: null, sourceKey: 'site', trustRank: 80 }),
      claim({ field: 'teamMax', valueJson: '4', sourceKey: 'devfolio', trustRank: 60 }),
    ];
    expect(resolve(quiet, []).fields.get('teamMax')?.valueJson).toBe('4');
  });

  it('a group is won by one record: the fee amount and currency are never spliced', () => {
    const spliced = [
      claim({ field: 'feeMinor', valueJson: '50000', sourceKey: 'site', trustRank: 80 }),
      claim({ field: 'feeCurrency', valueJson: '"INR"', sourceKey: 'site', trustRank: 80 }),
      claim({ field: 'feeMinor', valueJson: '1000', sourceKey: 'clist', trustRank: 20 }),
      claim({ field: 'feeCurrency', valueJson: '"USD"', sourceKey: 'clist', trustRank: 20 }),
    ];
    const result = resolve(spliced, []);
    expect(result.fields.get('feeMinor')?.valueJson).toBe('50000');
    expect(result.fields.get('feeCurrency')?.valueJson).toBe('"INR"');
  });
});

describe('material conflicts (§7.5)', () => {
  const at = (field: OverrideField, minutes: number): ResolvableClaim[] => [
    claim({ field, valueJson: String(T0), sourceKey: 'a', trustRank: 60 }),
    claim({ field, valueJson: String(T0 + minutes * MINUTE), sourceKey: 'b', trustRank: 40 }),
  ];

  it('59 minutes apart is not a conflict; 61 is', () => {
    expect(resolve(at('startsAt', 59), []).hasConflicts).toBe(false);
    expect(resolve(at('startsAt', 61), []).hasConflicts).toBe(true);
    expect(resolve(at('registrationDeadlineAt', 61), []).hasConflicts).toBe(true);
  });

  it('team size, fee and mode disagreements are material; title wording is not', () => {
    const pair = (field: OverrideField, a: string, b: string): ResolvableClaim[] => [
      claim({ field, valueJson: a, sourceKey: 'a' }),
      claim({ field, valueJson: b, sourceKey: 'b' }),
    ];
    expect(resolve(pair('teamMax', '4', '5'), []).hasConflicts).toBe(true);
    expect(resolve(pair('feeMinor', '0', '50000'), []).hasConflicts).toBe(true);
    expect(resolve(pair('mode', '"ONLINE"', '"OFFLINE"'), []).hasConflicts).toBe(true);
    const title = resolve(pair('title', '"HackX"', '"HackX 2026"'), []);
    expect(title.hasConflicts).toBe(false);
    expect(title.conflicts[0]).toMatchObject({ field: 'title', material: false });
  });

  it('an R63 alternate that differs is material and never selected', () => {
    const claims = [
      claim({ field: 'prizeText', valueJson: '"$500"', sourceKey: 'ctftime' }),
      claim({
        field: 'prizeText',
        valueJson: '"₹50,000"',
        sourceKey: 'ctftime',
        isAlternate: true,
      }),
    ];
    const result = resolve(claims, []);
    expect(result.fields.get('prizeText')?.valueJson).toBe('"$500"');
    expect(result.hasConflicts).toBe(true);
    expect([...result.selectedClaimIds]).toEqual([claims[0]!.id]);
  });

  it('"UNKNOWN" is not a value that disagrees', () => {
    const claims = [
      claim({ field: 'mode', valueJson: '"ONLINE"', sourceKey: 'a' }),
      claim({ field: 'mode', valueJson: '"UNKNOWN"', sourceKey: 'b', trustRank: 90 }),
    ];
    const result = resolve(claims, []);
    expect(result.hasConflicts).toBe(false);
    expect(result.fields.get('mode')?.valueJson).toBe('"ONLINE"');
  });
});

describe('nothing is averaged or invented (property)', () => {
  const FIELDS: OverrideField[] = [
    'title',
    'startsAt',
    'endsAt',
    'feeMinor',
    'feeCurrency',
    'teamMin',
    'teamMax',
    'mode',
    'prizeText',
    'city',
    'countryCode',
    ...FIELD_GROUPS.flat(),
  ];
  const value = fc.oneof(
    fc.constant(null),
    fc.integer({ min: 0, max: 2_000_000_000_000 }).map(String),
    fc.string({ maxLength: 12 }).map((text) => JSON.stringify(text)),
    fc.constantFrom('"ONLINE"', '"OFFLINE"', '"UNKNOWN"', '"INR"', '"USD"'),
  );
  const claimArb = fc.record({
    field: fc.constantFrom(...FIELDS),
    valueJson: value,
    record: fc.integer({ min: 0, max: 4 }),
    trustRank: fc.integer({ min: 0, max: 100 }),
    observedAt: fc.integer({ min: 0, max: 10 }),
    isAlternate: fc.boolean(),
  });
  const overrideArb = fc.record({
    field: fc.constantFrom(...FIELDS),
    valueJson: value,
    cleared: fc.boolean(),
  });

  it('every resolved value is byte-equal to some claim or to an active override', () => {
    fc.assert(
      fc.property(
        fc.array(claimArb, { maxLength: 40 }),
        fc.array(overrideArb, { maxLength: 4 }),
        (raw, rawOverrides) => {
          // One claim per (record, field, alternate), as the unique index guarantees.
          const seen = new Set<string>();
          const claims: ResolvableClaim[] = [];
          raw.forEach((entry, index) => {
            const key = `${String(entry.record)}|${entry.field}|${String(entry.isAlternate)}`;
            if (seen.has(key)) {
              return;
            }
            seen.add(key);
            claims.push({
              id: `p${String(index)}`,
              field: entry.field,
              valueJson: entry.valueJson,
              sourceRecordId: `r${String(entry.record)}`,
              sourceKey: `s${String(entry.record)}`,
              trustRank: entry.trustRank,
              observedAt: entry.observedAt,
              isAlternate: entry.isAlternate,
              note: null,
            });
          });
          const overrides: ResolvableOverride[] = rawOverrides.map((entry) => ({
            field: entry.field,
            valueJson: entry.valueJson,
            clearedAt: entry.cleared ? 1 : null,
          }));
          const result = resolve(claims, overrides);
          for (const resolved of result.fields.values()) {
            const fromClaims = claims
              .filter((candidate) => candidate.field === resolved.field && !candidate.isAlternate)
              .map((candidate) => candidate.valueJson);
            const fromOverrides = overrides
              .filter(
                (candidate) => candidate.field === resolved.field && candidate.clearedAt === null,
              )
              .map((candidate) => candidate.valueJson);
            if (resolved.from === 'OVERRIDE') {
              expect(fromOverrides).toContain(resolved.valueJson);
            } else if (resolved.from === 'CLAIM') {
              expect(fromClaims).toContain(resolved.valueJson);
            } else {
              expect(resolved.valueJson).toBeNull();
            }
          }
          for (const id of result.selectedClaimIds) {
            expect(claims.find((candidate) => candidate.id === id)?.isAlternate).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
