import type {
  ConflictDto,
  DedupCandidateDto,
  DedupCandidateList,
  DedupCandidateQuery,
  DedupEventBrief,
  DedupFeatures,
  EventChangePage,
  EventConflicts,
  UnmergeResult,
  MergeResult,
} from '@compintel/contracts';

import type { DedupCandidateRow, EventRow } from '../../db/schema/index.js';
import { assertCan } from '../auth/policy.js';
import type { DedupCandidatesRepository } from './dedup-repository.js';
import { eventNotFound } from './errors.js';
import type { MergeContext, MergeService } from './merge.js';
import type { ProvenanceRepository } from './provenance.js';
import type { EventsRepository } from './repository.js';
import type { EventResolver } from './resolver.js';

/**
 * The admin review API's service (§10.2 "Review/merge/unmerge duplicates") and
 * the two read endpoints every signed-in user has: an event's conflicts — the
 * "Sources disagree" payload WP-16b renders — and its change history.
 */

export interface DedupReviewDependencies {
  readonly events: EventsRepository;
  readonly provenance: ProvenanceRepository;
  readonly candidates: DedupCandidatesRepository;
  readonly resolver: EventResolver;
  readonly merges: MergeService;
}

function parseJson(value: string | null): unknown {
  return value === null ? null : (JSON.parse(value) as unknown);
}

export class DedupReviewService {
  readonly #deps: DedupReviewDependencies;

  constructor(deps: DedupReviewDependencies) {
    this.#deps = deps;
  }

  #brief(event: EventRow): DedupEventBrief {
    return {
      id: event.id,
      title: event.title,
      editionYear: event.editionYear,
      organizerName: event.organizerName,
      mode: event.mode,
      city: event.city,
      countryCode: event.countryCode,
      startsAt: event.startsAt,
      registrationDeadlineAt: event.registrationDeadlineAt,
      datePrecision: event.datePrecision,
      officialUrl: event.officialUrl,
      visibility: event.visibility,
      sourceKeys: this.#deps.provenance.sourceKeysOf(event.id),
    };
  }

  #dto(row: DedupCandidateRow): DedupCandidateDto {
    const a = this.#deps.events.getById(row.eventIdA);
    const b = this.#deps.events.getById(row.eventIdB);
    if (a === undefined || b === undefined) {
      throw eventNotFound(a === undefined ? row.eventIdA : row.eventIdB);
    }
    return {
      id: row.id,
      status: row.status,
      score: { total: row.score, features: JSON.parse(row.featuresJson) as DedupFeatures },
      eventA: this.#brief(a),
      eventB: this.#brief(b),
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      decidedBy: row.decidedBy,
      version: row.version,
    };
  }

  listCandidates(context: MergeContext, query: DedupCandidateQuery): DedupCandidateList {
    assertCan(context.actor, 'duplicate.review');
    return {
      items: this.#deps.candidates
        .list(query.status, query.limit, query.offset)
        .map((row) => this.#dto(row)),
      total: this.#deps.candidates.count(query.status),
    };
  }

  merge(context: MergeContext, candidateId: string, version: number): MergeResult {
    const outcome = this.#deps.merges.merge(context, candidateId, version);
    return {
      survivorId: outcome.survivorId,
      mergedId: outcome.mergedId,
      candidate: this.#dto(outcome.candidate),
    };
  }

  reject(context: MergeContext, candidateId: string, version: number): DedupCandidateDto {
    return this.#dto(this.#deps.merges.reject(context, candidateId, version));
  }

  unmerge(context: MergeContext, eventId: string, version: number): UnmergeResult {
    return this.#deps.merges.unmerge(context, eventId, version);
  }

  /** Every field whose claims differ, with each value and its source (§7.5). */
  conflicts(context: MergeContext, eventId: string): EventConflicts {
    assertCan(context.actor, 'event.view');
    const event = this.#deps.events.getById(eventId);
    if (event === undefined) {
      throw eventNotFound(eventId);
    }
    const resolution = this.#deps.resolver.resolutionOf(eventId);
    const conflicts: ConflictDto[] = resolution.conflicts.map((conflict) => {
      const selected = resolution.fields.get(conflict.field);
      return {
        field: conflict.field,
        material: conflict.material,
        values: conflict.claims.map((claim) => ({
          value: parseJson(claim.valueJson) as ConflictDto['selected'],
          sourceKey: claim.sourceKey,
          sourceRecordId: claim.sourceRecordId,
          trustRank: claim.trustRank,
          observedAt: claim.observedAt,
          alternate: claim.isAlternate,
          note: claim.note,
        })),
        selected: parseJson(selected?.valueJson ?? null) as ConflictDto['selected'],
        selectedFrom: selected?.from === 'OVERRIDE' ? 'OVERRIDE' : 'CLAIM',
      };
    });
    return { eventId, hasConflicts: event.hasConflicts, conflicts };
  }

  changes(context: MergeContext, eventId: string, limit: number, cursor?: string): EventChangePage {
    assertCan(context.actor, 'event.view');
    if (this.#deps.events.getById(eventId) === undefined) {
      throw eventNotFound(eventId);
    }
    const rows = this.#deps.provenance.changesOf(eventId, limit + 1, cursor);
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        field: row.field,
        oldValue: parseJson(row.oldValueJson) as EventChangePage['items'][number]['oldValue'],
        newValue: parseJson(row.newValueJson) as EventChangePage['items'][number]['newValue'],
        cause: row.cause,
        sourceRecordId: row.sourceRecordId,
        changedBy: row.changedBy,
        detectedAt: row.detectedAt,
      })),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
