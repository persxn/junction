import type {
  ChangeCause,
  EventCandidate,
  EventTypePolicy,
  GeographyPolicy,
  OverrideField,
} from '@compintel/contracts';

import type { EventRow } from '../../db/schema/index.js';
import { CLAIMED_FIELDS } from '../../domain/events/claims.js';
import { qualityScoreOf } from '../../domain/events/quality.js';
import { resolve, type Resolution } from '../../domain/events/resolve.js';
import { combinedPrecision } from '../../domain/normalize/dates.js';
import { normalizeTitle } from '../../domain/normalize/text.js';
import { applyPolicies } from '../../domain/policy/index.js';
import type { ProvenanceRepository } from './provenance.js';
import type { EventsRepository } from './repository.js';

/**
 * Re-resolving one event from everything known about it (§7.5), shared by the
 * scrape linker, merge and unmerge so the three can never disagree on what an
 * event's row should say.
 *
 * It reads the event's claims and overrides, asks the pure resolver which
 * value wins each field, writes the row, marks the selected claims, and writes
 * one `event_changes` row for every **selected** value that moved — with the
 * cause and, for a scrape, the source record that moved it. Always inside the
 * caller's transaction.
 */

export interface ApplyContext {
  readonly cause: ChangeCause;
  readonly at: number;
  readonly sourceRecordId?: string | undefined;
  readonly changedBy?: string | undefined;
  /** A brand-new event has no "before"; its first resolution is not a change. */
  readonly creating?: boolean;
}

export interface ApplyResult {
  readonly resolution: Resolution;
  readonly changedFields: readonly OverrideField[];
}

/** Columns that are NOT NULL on `events`; a missing claim falls back to the column default. */
const NOT_NULL_DEFAULTS: Partial<Record<OverrideField, unknown>> = {
  mode: 'UNKNOWN',
  organizerKind: 'UNKNOWN',
  geoPrecision: 'UNKNOWN',
  feeKnown: false,
  isRecurringRound: false,
};

function jsonOf(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export class EventResolver {
  readonly #events: EventsRepository;
  readonly #provenance: ProvenanceRepository;
  readonly #policies: () => { eventType: EventTypePolicy; geography: GeographyPolicy };
  readonly #onResolved: ((eventId: string, at: number) => void) | undefined;

  constructor(deps: {
    events: EventsRepository;
    provenance: ProvenanceRepository;
    policies: () => { eventType: EventTypePolicy; geography: GeographyPolicy };
    /**
     * WP-15b: runs after every resolution, in the caller's transaction — the
     * category classifier, so every ingest path (scrape, import, manual entry,
     * merge, unmerge) re-derives an event's categories from its latest state.
     */
    onResolved?: (eventId: string, at: number) => void;
  }) {
    this.#events = deps.events;
    this.#provenance = deps.provenance;
    this.#policies = deps.policies;
    this.#onResolved = deps.onResolved;
  }

  /** The current resolution, read-only — what `/events/:id/conflicts` shows. */
  resolutionOf(eventId: string): Resolution {
    return resolve(this.#provenance.claimsOf(eventId), this.#provenance.overridesOf(eventId));
  }

  apply(eventId: string, context: ApplyContext): ApplyResult {
    const row = this.#events.getById(eventId);
    if (row === undefined) {
      throw new Error(`event ${eventId} does not exist`);
    }
    const claims = this.#provenance.claimsOf(eventId);
    const resolution = resolve(claims, this.#provenance.overridesOf(eventId));
    const payloads = new Map(
      this.#provenance
        .recordsOf(eventId)
        .map((record) => [record.id, JSON.parse(record.payloadJson) as EventCandidate]),
    );
    const recordOfClaim = new Map(claims.map((claim) => [claim.id, claim.sourceRecordId]));
    const winnerPayload = (field: OverrideField): EventCandidate | undefined => {
      const claimId = resolution.fields.get(field)?.claimId;
      const recordId = claimId === undefined ? undefined : recordOfClaim.get(claimId);
      return recordId === undefined ? undefined : payloads.get(recordId);
    };

    // ---- The resolved columns -------------------------------------------------
    const patch: Record<string, unknown> = {};
    for (const field of CLAIMED_FIELDS) {
      const resolved = resolution.fields.get(field);
      const value =
        resolved?.valueJson === null || resolved?.valueJson === undefined
          ? (NOT_NULL_DEFAULTS[field] ?? null)
          : (JSON.parse(resolved.valueJson) as unknown);
      patch[field] = value;
    }
    // Two columns can never be empty; a source that stopped naming them does
    // not blank them.
    patch.title ??= row.title;
    patch.eventType ??= row.eventType;
    patch.normalizedTitle = normalizeTitle(String(patch.title));

    // Precisions and eligibility flags travel with the claim that won their field.
    const dates = winnerPayload('startsAt');
    patch.datePrecision =
      resolution.fields.get('startsAt')?.from === 'OVERRIDE'
        ? 'DATETIME'
        : dates === undefined
          ? 'UNKNOWN'
          : combinedPrecision({ startsAt: dates.startsAt, endsAt: dates.endsAt });
    patch.registrationDeadlinePrecision =
      resolution.fields.get('registrationDeadlineAt')?.from === 'OVERRIDE'
        ? 'DATETIME'
        : (winnerPayload('registrationDeadlineAt')?.registrationDeadlineAt?.precision ?? 'UNKNOWN');
    const eligibility = winnerPayload('eligibilityText')?.eligibility;
    patch.eligibilityJson = eligibility === undefined ? null : JSON.stringify(eligibility);

    // ---- Visibility: the policy judges resolved facts (R57) -------------------
    if (row.visibility === 'VISIBLE' || row.visibility === 'POLICY_HIDDEN') {
      // The policy hides only a *confident* OTHER (WP-08b), so the confidence of
      // the claim that won `eventType` goes with it — found missing in WP-13,
      // where Unstop's quizzes stayed visible.
      const typeFromClaim = resolution.fields.get('eventType')?.from === 'CLAIM';
      const typeConfidence = typeFromClaim ? winnerPayload('eventType')?.eventType.confidence : 1;
      const verdict = applyPolicies(
        {
          mode: patch.mode as EventRow['mode'],
          countryCode: (patch.countryCode as string | null) ?? undefined,
          eventType: patch.eventType as EventRow['eventType'],
          ...(typeConfidence === undefined ? {} : { confidence: typeConfidence }),
        },
        this.#policies(),
      );
      patch.visibility = verdict.visibility;
      patch.policyReason = verdict.reason ?? null;
    }

    // ---- What moved -----------------------------------------------------------
    const tracked: readonly OverrideField[] = [...CLAIMED_FIELDS, 'visibility'];
    const current = row as unknown as Record<string, unknown>;
    const changedFields = tracked.filter(
      (field) => field in patch && jsonOf(current[field]) !== jsonOf(patch[field]),
    );
    if (context.creating !== true) {
      for (const field of changedFields) {
        this.#provenance.insertChange({
          eventId,
          field,
          oldValueJson: jsonOf(current[field]),
          newValueJson: jsonOf(patch[field]),
          cause: context.cause,
          sourceRecordId: context.sourceRecordId,
          changedBy: context.changedBy,
          at: context.at,
        });
      }
    }

    const next = { ...current, ...patch } as EventRow;
    patch.hasConflicts = resolution.hasConflicts;
    patch.qualityScore = qualityScoreOf(next);
    const rowChanged =
      changedFields.length > 0 ||
      Object.keys(patch).some((key) => jsonOf(current[key]) !== jsonOf(patch[key]));
    if (rowChanged || context.creating === true) {
      if (changedFields.length > 0 || context.creating === true) {
        patch.lastChangedAt = context.at;
      }
      patch.updatedAt = context.at;
      patch.version = context.creating === true ? row.version : row.version + 1;
      this.#events.update(eventId, patch);
    }
    this.#provenance.setSelected(eventId, resolution.selectedClaimIds);
    this.#onResolved?.(eventId, context.at);
    return { resolution, changedFields: context.creating === true ? [] : changedFields };
  }
}
