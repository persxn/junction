import {
  changeCauseLabel,
  overrideFieldLabel,
  type ClaimGroup,
  type DetailConflict,
  type EventChangePage,
  type EventDetailView,
  type FieldClaim,
  type OverrideField,
  type SelectionReason,
} from '@compintel/contracts';

import {
  isInformative,
  selectionReasonOf,
  type ResolvableClaim,
  type Resolution,
} from '../../domain/events/resolve.js';
import { hasMeasurableLocation, haversineKm } from '../../domain/geo/distance.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { toCore } from '../search/mapping.js';
import type { EventDetailRepository } from './detail-repo.js';
import { eventNotFound } from './errors.js';
import type { ProvenanceRepository } from './provenance.js';
import type { EventsRepository } from './repository.js';
import type { EventResolver } from './resolver.js';

/**
 * `GET /events/:id/detail` — everything §16.2's drawer shows, in one round trip.
 *
 * The drawer is where the project's trust story becomes visible, so this
 * service does no smoothing of any kind (§7.5): a claim's value is the JSON its
 * source stated, a conflict lists every claimed value with who said it and
 * when, and the selected one carries the reason it won rather than an implied
 * "we picked the best". The words for fields and causes come from the
 * contracts' tables, so the backend, the drawer and the history cannot word the
 * same field three ways.
 */

export const HISTORY_PAGE_SIZE = 20;

export interface EventDetailContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface EventDetailDependencies {
  readonly events: EventsRepository;
  readonly provenance: ProvenanceRepository;
  readonly resolver: EventResolver;
  readonly detail: EventDetailRepository;
  readonly historyPageSize?: number;
}

/** A stored `value_json` as the DTO carries it: decoded, never re-serialized. */
function parseJson(value: string | null): FieldClaim['value'] {
  return value === null ? null : (JSON.parse(value) as FieldClaim['value']);
}

export class EventDetailService {
  readonly #deps: EventDetailDependencies;

  constructor(deps: EventDetailDependencies) {
    this.#deps = deps;
  }

  detail(context: EventDetailContext, eventId: string): EventDetailView {
    assertCan(context.actor, 'event.view');
    const event = this.#deps.events.getVisibleEventById(eventId);
    if (event === undefined) {
      throw eventNotFound(eventId);
    }
    const claims = this.#deps.provenance.claimsOf(eventId);
    const resolution = this.#deps.resolver.resolutionOf(eventId);
    const sources = this.#deps.detail.sourcesOf(eventId);
    const names = new Map(sources.map((source) => [source.key, source.name]));
    const campus = this.#deps.detail.primaryCampus();

    const core = toCore(event, {
      // R81: a state or country centroid is not a place to measure from.
      distanceKm:
        campus === undefined || !hasMeasurableLocation(event)
          ? null
          : haversineKm(campus, { lat: event.lat, lon: event.lon }),
      deadlines: this.#deps.events.deadlinesOf(eventId).map((deadline) => ({
        id: deadline.id,
        kind: deadline.kind,
        label: deadline.label,
        dueAt: deadline.dueAt,
        precision: deadline.precision,
        origin: deadline.origin,
      })),
      sources: [],
      categories: [],
    });
    const { sources: _sources, categories: _categories, ...rest } = core;

    return {
      ...rest,
      claims: this.#claimGroups(claims, resolution, names),
      hasConflicts: event.hasConflicts,
      conflicts: this.#conflicts(claims, resolution, names),
      sources,
      categories: this.#deps.detail.categoriesOf(eventId),
      history: this.history(context, eventId),
    };
  }

  /** Newest first, cursor-paged; "load older" sends the last id back. */
  history(context: EventDetailContext, eventId: string, cursor?: string): EventChangePage {
    assertCan(context.actor, 'event.view');
    const limit = this.#deps.historyPageSize ?? HISTORY_PAGE_SIZE;
    const rows = this.#deps.provenance.changesOf(eventId, limit + 1, cursor);
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        field: row.field,
        fieldLabel: overrideFieldLabel(row.field),
        oldValue: parseJson(row.oldValueJson),
        newValue: parseJson(row.newValueJson),
        cause: row.cause,
        causeLabel: changeCauseLabel(row.cause),
        sourceRecordId: row.sourceRecordId,
        changedBy: row.changedBy,
        detectedAt: row.detectedAt,
      })),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** One entry per field that has a claim, best claim first (§7.5's order). */
  #claimGroups(
    claims: readonly ResolvableClaim[],
    resolution: Resolution,
    names: ReadonlyMap<string, string>,
  ): ClaimGroup[] {
    const fields = new Map<OverrideField, ResolvableClaim[]>();
    for (const claim of claims) {
      fields.set(claim.field, [...(fields.get(claim.field) ?? []), claim]);
    }
    const groups: ClaimGroup[] = [];
    for (const [field, group] of fields) {
      const informative = group.filter((claim) => isInformative(claim.valueJson));
      if (informative.length === 0) {
        continue;
      }
      const resolved = resolution.fields.get(field);
      const selected = informative.find((claim) => claim.id === resolved?.claimId);
      const reason: SelectionReason = selectionReasonOf(field, claims, resolved);
      groups.push({
        field,
        label: overrideFieldLabel(field),
        claims: [...informative]
          .sort((a, b) => b.trustRank - a.trustRank || b.observedAt - a.observedAt)
          .map((claim) => this.#claim(claim, resolution, names)),
        selectedReason: reason,
        selectedSourceName:
          reason === 'OVERRIDE'
            ? null
            : selected === undefined
              ? null
              : (names.get(selected.sourceKey) ?? selected.sourceKey),
        verifiedAt: selected?.observedAt ?? null,
      });
    }
    return groups.sort((a, b) => (a.field < b.field ? -1 : 1));
  }

  #claim(
    claim: ResolvableClaim,
    resolution: Resolution,
    names: ReadonlyMap<string, string>,
  ): FieldClaim {
    return {
      id: claim.id,
      value: parseJson(claim.valueJson),
      sourceKey: claim.sourceKey,
      sourceName: names.get(claim.sourceKey) ?? claim.sourceKey,
      trustRank: claim.trustRank,
      observedAt: claim.observedAt,
      isSelected: resolution.selectedClaimIds.has(claim.id),
      isAlternate: claim.isAlternate,
      note: claim.note,
    };
  }

  /** §7.5's "Sources disagree": every claimed value, and why the selected one won. */
  #conflicts(
    claims: readonly ResolvableClaim[],
    resolution: Resolution,
    names: ReadonlyMap<string, string>,
  ): DetailConflict[] {
    return resolution.conflicts.map((conflict) => {
      const resolved = resolution.fields.get(conflict.field);
      const reason: SelectionReason = selectionReasonOf(conflict.field, claims, resolved);
      const selected = conflict.claims.find((claim) => claim.id === resolved?.claimId);
      return {
        field: conflict.field,
        label: overrideFieldLabel(conflict.field),
        material: conflict.material,
        values: conflict.claims.map((claim) => ({
          value: parseJson(claim.valueJson),
          sourceKey: claim.sourceKey,
          sourceRecordId: claim.sourceRecordId,
          trustRank: claim.trustRank,
          observedAt: claim.observedAt,
          alternate: claim.isAlternate,
          note: claim.note,
        })),
        selected: parseJson(resolved?.valueJson ?? null),
        selectedReason: reason,
        selectedSourceName:
          reason === 'OVERRIDE'
            ? null
            : selected === undefined
              ? null
              : (names.get(selected.sourceKey) ?? selected.sourceKey),
        selectedSourceRecordId: reason === 'OVERRIDE' ? null : (selected?.sourceRecordId ?? null),
      };
    });
  }
}
