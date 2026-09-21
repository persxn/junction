import type { OverrideField, SelectionReason } from '@compintel/contracts';

/**
 * Field resolution over one event's claims (§7.5). Pure.
 *
 * **Active override > highest `trust_rank` > most recent observation.** The
 * resolved value of a field is always exactly one claim's `value_json` or one
 * override's — the string itself, never re-serialized — so "nothing is
 * averaged, invented, spliced or converted" is a property of the types rather
 * than of good intentions, and the property test checks it byte for byte.
 *
 * Fields that only make sense together are resolved together. A fee is an
 * amount *and* a currency; taking the amount from one source and the currency
 * from another would be exactly the silent conversion §7.3 forbids. So each
 * group below is won by one source record, and every field of the group comes
 * from that record. An override still applies per field on top.
 */

export interface ResolvableClaim {
  readonly id: string;
  readonly field: OverrideField;
  /** JSON; `null` is the source saying the field is empty. */
  readonly valueJson: string | null;
  readonly sourceRecordId: string;
  readonly sourceKey: string;
  readonly trustRank: number;
  readonly observedAt: number;
  /** R63: a second statement that never wins, but can disagree. */
  readonly isAlternate: boolean;
  readonly note: string | null;
}

export interface ResolvableOverride {
  readonly field: OverrideField;
  readonly valueJson: string | null;
  readonly clearedAt: number | null;
}

export interface ResolvedField {
  readonly field: OverrideField;
  readonly valueJson: string | null;
  readonly from: 'CLAIM' | 'OVERRIDE' | 'NONE';
  /** The winning claim, when a claim won (also set under an override, for provenance). */
  readonly claimId: string | undefined;
}

export interface FieldConflict {
  readonly field: OverrideField;
  /** §7.5's "materially": dates > 1 h apart, team size, fee, mode — and R63 second claims. */
  readonly material: boolean;
  readonly claims: readonly ResolvableClaim[];
}

export interface Resolution {
  readonly fields: ReadonlyMap<OverrideField, ResolvedField>;
  /** The claims to mark `is_selected`. Never an alternate. */
  readonly selectedClaimIds: ReadonlySet<string>;
  readonly conflicts: readonly FieldConflict[];
  readonly hasConflicts: boolean;
}

/** Fields won together by one source record. */
export const FIELD_GROUPS: readonly (readonly OverrideField[])[] = [
  ['feeKnown', 'feeMinor', 'feeCurrency', 'feeText'],
  ['prizeText', 'prizeTotalMinor', 'prizeCurrency'],
  ['venueName', 'city', 'state', 'countryCode', 'lat', 'lon', 'geoPrecision', 'hostInstitutionId'],
  ['startsAt', 'endsAt'],
  ['teamMin', 'teamMax'],
];

const DATE_FIELDS: ReadonlySet<OverrideField> = new Set([
  'registrationOpensAt',
  'registrationDeadlineAt',
  'startsAt',
  'endsAt',
  'submissionDeadlineAt',
]);

/** Fields whose any disagreement is material (§7.5). */
const MATERIAL_FIELDS: ReadonlySet<OverrideField> = new Set([
  'teamMin',
  'teamMax',
  'feeKnown',
  'feeMinor',
  'feeCurrency',
  'mode',
]);

/** §7.5: dates more than an hour apart. Exactly an hour is not "more than". */
export const DATE_CONFLICT_MS = 3_600_000;

/** A claim that says something: not empty, and not the enums' "we do not know". */
export function isInformative(valueJson: string | null): boolean {
  return valueJson !== null && valueJson !== '"UNKNOWN"';
}

/** Higher trust first, then the more recent observation, then a stable id order. */
function precedes(a: ResolvableClaim, b: ResolvableClaim): number {
  return (
    b.trustRank - a.trustRank ||
    b.observedAt - a.observedAt ||
    (a.sourceRecordId < b.sourceRecordId ? -1 : a.sourceRecordId > b.sourceRecordId ? 1 : 0)
  );
}

function groupOf(field: OverrideField): readonly OverrideField[] {
  return FIELD_GROUPS.find((group) => group.includes(field)) ?? [field];
}

/** The source record that wins a group: the best-ranked one that says anything. */
function winningRecord(
  group: readonly OverrideField[],
  claims: readonly ResolvableClaim[],
): string | undefined {
  const inGroup = claims.filter((claim) => !claim.isAlternate && group.includes(claim.field));
  const informative = inGroup.filter((claim) => isInformative(claim.valueJson));
  const pool = informative.length > 0 ? informative : inGroup;
  return [...pool].sort(precedes)[0]?.sourceRecordId;
}

function conflictOf(
  field: OverrideField,
  claims: readonly ResolvableClaim[],
  selected: string | null,
): FieldConflict | undefined {
  const mine = claims.filter((claim) => claim.field === field && isInformative(claim.valueJson));
  const distinct = new Set(mine.map((claim) => claim.valueJson));
  if (distinct.size < 2) {
    return undefined;
  }
  let material = MATERIAL_FIELDS.has(field);
  if (DATE_FIELDS.has(field)) {
    const instants = mine.map((claim) => Number(JSON.parse(claim.valueJson ?? 'null')));
    material = Math.max(...instants) - Math.min(...instants) > DATE_CONFLICT_MS;
  }
  // §7.3 / R63: a source contradicting itself is always worth showing.
  if (mine.some((claim) => claim.isAlternate && claim.valueJson !== selected)) {
    material = true;
  }
  return { field, material, claims: [...mine].sort(precedes) };
}

/** Resolves every field that has at least one claim or an active override. */
export function resolve(
  claims: readonly ResolvableClaim[],
  overrides: readonly ResolvableOverride[],
): Resolution {
  const active = new Map<OverrideField, ResolvableOverride>();
  for (const override of overrides) {
    if (override.clearedAt === null) {
      active.set(override.field, override);
    }
  }

  const fields = new Map<OverrideField, ResolvedField>();
  const selectedClaimIds = new Set<string>();
  const winners = new Map<readonly OverrideField[], string | undefined>();
  const names = new Set<OverrideField>([...claims.map((claim) => claim.field), ...active.keys()]);

  for (const field of names) {
    const group = groupOf(field);
    if (!winners.has(group)) {
      winners.set(group, winningRecord(group, claims));
    }
    const record = winners.get(group);
    const claim = claims.find(
      (candidate) =>
        !candidate.isAlternate && candidate.field === field && candidate.sourceRecordId === record,
    );
    if (claim !== undefined) {
      selectedClaimIds.add(claim.id);
    }
    const override = active.get(field);
    if (override !== undefined) {
      fields.set(field, {
        field,
        valueJson: override.valueJson,
        from: 'OVERRIDE',
        claimId: claim?.id,
      });
    } else {
      fields.set(field, {
        field,
        valueJson: claim?.valueJson ?? null,
        from: claim === undefined ? 'NONE' : 'CLAIM',
        claimId: claim?.id,
      });
    }
  }

  const conflicts: FieldConflict[] = [];
  for (const field of names) {
    const conflict = conflictOf(field, claims, fields.get(field)?.valueJson ?? null);
    if (conflict !== undefined) {
      conflicts.push(conflict);
    }
  }
  conflicts.sort((a, b) => (a.field < b.field ? -1 : 1));

  return {
    fields,
    selectedClaimIds,
    conflicts,
    hasConflicts: conflicts.some((conflict) => conflict.material),
  };
}

/**
 * Why the selected value of a field is the one it is (§7.5, WP-16b).
 *
 * The answer is read off the same pool the selection was made from — the
 * field's **group**, because `winningRecord` picks one source record for the
 * whole group — so the drawer never explains a decision that was not the one
 * taken. With one informative claim there is no contest (`ONLY_SOURCE`);
 * otherwise the winner either out-ranked the rest (`HIGHEST_TRUST`) or tied on
 * rank and was seen later (`MOST_RECENT`), which is exactly the ladder.
 */
export function selectionReasonOf(
  field: OverrideField,
  claims: readonly ResolvableClaim[],
  resolved: ResolvedField | undefined,
): SelectionReason {
  if (resolved?.from === 'OVERRIDE') {
    return 'OVERRIDE';
  }
  const group = groupOf(field);
  const pool = claims.filter(
    (claim) => !claim.isAlternate && group.includes(claim.field) && isInformative(claim.valueJson),
  );
  const records = new Set(pool.map((claim) => claim.sourceRecordId));
  if (records.size <= 1) {
    return 'ONLY_SOURCE';
  }
  const winner =
    pool.find((claim) => claim.id === resolved?.claimId) ?? [...pool].sort(precedes)[0];
  if (winner === undefined) {
    return 'ONLY_SOURCE';
  }
  const rivals = pool.filter((claim) => claim.sourceRecordId !== winner.sourceRecordId);
  return rivals.every((claim) => claim.trustRank < winner.trustRank)
    ? 'HIGHEST_TRUST'
    : 'MOST_RECENT';
}
