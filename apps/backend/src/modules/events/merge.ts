import type { Visibility } from '@compintel/contracts';

import type { DedupCandidateRow, EventRow } from '../../db/schema/index.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import type { DedupCandidatesRepository } from './dedup-repository.js';
import {
  dedupCandidateNotFound,
  eventAlreadyMerged,
  eventCandidateDecided,
  eventMergeSelf,
  eventNotFound,
  eventNotMerged,
  eventVersionConflict,
} from './errors.js';
import type { ProvenanceRepository } from './provenance.js';
import type { EventsRepository } from './repository.js';
import type { EventResolver } from './resolver.js';

/**
 * Merge, unmerge and reject (§7.5, ruling R66). Admin only (§10.2).
 *
 * **A merge deletes nothing.** The survivor is the event seen first (tie: the
 * one with more source records); the other keeps its row, turns `MERGED` and
 * points at the survivor; its source records move — and their claims and
 * source deadlines move with them. Unmerge moves exactly those records back,
 * because each remembers the event it was first linked to
 * (`source_records.origin_event_id`). What stays where it is, on both sides:
 * overrides, `event_changes`, and every row keyed by the event id itself —
 * which is also where WP-16a's watchlist and per-user state will live.
 */

export interface MergeContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface MergeServiceDependencies {
  readonly events: EventsRepository;
  readonly provenance: ProvenanceRepository;
  readonly candidates: DedupCandidatesRepository;
  readonly resolver: EventResolver;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export interface MergeOutcome {
  readonly survivorId: string;
  readonly mergedId: string;
  readonly candidate: DedupCandidateRow;
}

export class MergeService {
  readonly #deps: MergeServiceDependencies;
  readonly #clock: Clock;

  constructor(deps: MergeServiceDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  /** R66's survivor: earlier `first_seen_at`, then more source records, then the lower id. */
  #survivor(a: EventRow, b: EventRow): [EventRow, EventRow] {
    const byFirstSeen = a.firstSeenAt - b.firstSeenAt;
    if (byFirstSeen !== 0) {
      return byFirstSeen < 0 ? [a, b] : [b, a];
    }
    const records =
      this.#deps.provenance.recordsOf(b.id).length - this.#deps.provenance.recordsOf(a.id).length;
    if (records !== 0) {
      return records < 0 ? [a, b] : [b, a];
    }
    return a.id < b.id ? [a, b] : [b, a];
  }

  #pending(context: MergeContext, id: string, version: number): DedupCandidateRow {
    assertCan(context.actor, 'event.merge_duplicates');
    const row = this.#deps.candidates.get(id);
    if (row === undefined) {
      throw dedupCandidateNotFound(id);
    }
    if (row.version !== version) {
      throw eventVersionConflict('This pair', version, row.version);
    }
    if (row.status !== 'PENDING') {
      throw eventCandidateDecided(row.status);
    }
    return row;
  }

  merge(context: MergeContext, candidateId: string, version: number): MergeOutcome {
    const { events, provenance, candidates, resolver } = this.#deps;
    return withAudit(
      this.#deps.audit,
      (outcome: MergeOutcome) => ({
        actorKind: 'USER' as const,
        actorUserId: context.actor.id,
        action: 'event.merged',
        entityKind: 'event',
        entityId: outcome.survivorId,
        summary: `Merged a duplicate into ${outcome.survivorId}`,
        diff: { mergedId: outcome.mergedId, candidateId },
        requestId: context.requestId ?? null,
      }),
      (): MergeOutcome => {
        const row = this.#pending(context, candidateId, version);
        if (row.eventIdA === row.eventIdB) {
          throw eventMergeSelf();
        }
        const a = events.getById(row.eventIdA);
        const b = events.getById(row.eventIdB);
        if (a === undefined || b === undefined) {
          throw eventNotFound(a === undefined ? row.eventIdA : row.eventIdB);
        }
        for (const side of [a, b]) {
          if (side.visibility === 'MERGED') {
            throw eventAlreadyMerged(side.id);
          }
        }
        const at = nowMs(this.#clock);
        const [survivor, loser] = this.#survivor(a, b);

        provenance.moveRecords(
          provenance.recordsOf(loser.id).map((record) => record.id),
          survivor.id,
        );
        events.update(loser.id, {
          visibility: 'MERGED',
          mergedIntoEventId: survivor.id,
          updatedAt: at,
          version: loser.version + 1,
        });
        provenance.insertChange({
          eventId: loser.id,
          field: 'visibility',
          oldValueJson: JSON.stringify(loser.visibility),
          newValueJson: JSON.stringify('MERGED'),
          cause: 'MERGE',
          changedBy: context.actor.id,
          at,
        });
        resolver.apply(survivor.id, { cause: 'MERGE', at, changedBy: context.actor.id });
        const decided = candidates.decide(row, 'MERGED', context.actor.id, at);
        return { survivorId: survivor.id, mergedId: loser.id, candidate: decided };
      },
    );
  }

  reject(context: MergeContext, candidateId: string, version: number): DedupCandidateRow {
    return withAudit(
      this.#deps.audit,
      (decided: DedupCandidateRow) => ({
        actorKind: 'USER' as const,
        actorUserId: context.actor.id,
        action: 'event.duplicate.rejected',
        entityKind: 'dedup_candidate',
        entityId: decided.id,
        summary: 'Marked a possible duplicate as two different events',
        diff: { eventIdA: decided.eventIdA, eventIdB: decided.eventIdB },
        requestId: context.requestId ?? null,
      }),
      (): DedupCandidateRow => {
        const row = this.#pending(context, candidateId, version);
        return this.#deps.candidates.decide(row, 'REJECTED', context.actor.id, nowMs(this.#clock));
      },
    );
  }

  /** The live event a merged one's records now sit on (merges can chain). */
  #holderOf(event: EventRow): EventRow {
    let current = event;
    const seen = new Set<string>();
    while (current.mergedIntoEventId !== null && !seen.has(current.id)) {
      seen.add(current.id);
      const next = this.#deps.events.getById(current.mergedIntoEventId);
      if (next === undefined) {
        break;
      }
      current = next;
    }
    return current;
  }

  /** `root` and every event merged into it, directly or through a chain. */
  #mergedTree(root: string): string[] {
    const tree = [root];
    let frontier = [root];
    while (frontier.length > 0) {
      const children = this.#deps.events
        .mergedInto(frontier)
        .map((event) => event.id)
        .filter((id) => !tree.includes(id));
      tree.push(...children);
      frontier = children;
    }
    return tree;
  }

  unmerge(
    context: MergeContext,
    eventId: string,
    version: number,
  ): { restoredId: string; fromEventId: string } {
    assertCan(context.actor, 'event.merge_duplicates');
    const { events, provenance, candidates, resolver } = this.#deps;
    return withAudit(
      this.#deps.audit,
      (result: { restoredId: string; fromEventId: string }) => ({
        actorKind: 'USER' as const,
        actorUserId: context.actor.id,
        action: 'event.unmerged',
        entityKind: 'event',
        entityId: result.restoredId,
        summary: `Split ${result.restoredId} back out of ${result.fromEventId}`,
        diff: { fromEventId: result.fromEventId },
        requestId: context.requestId ?? null,
      }),
      () => {
        const loser = events.getById(eventId);
        if (loser === undefined) {
          throw eventNotFound(eventId);
        }
        if (loser.version !== version) {
          throw eventVersionConflict('This event', version, loser.version);
        }
        if (loser.visibility !== 'MERGED' || loser.mergedIntoEventId === null) {
          throw eventNotMerged(eventId);
        }
        const at = nowMs(this.#clock);
        const parentId = loser.mergedIntoEventId;
        const holder = this.#holderOf(loser);

        const records = provenance.recordsFrom(holder.id, this.#mergedTree(loser.id));
        provenance.moveRecords(
          records.map((record) => record.id),
          loser.id,
        );
        // Exactly what it was before the merge — including an admin's hide.
        const before = provenance.lastMergeChange(loser.id, 'visibility')?.oldValueJson;
        const restored = (
          before === null || before === undefined ? 'VISIBLE' : JSON.parse(before)
        ) as Visibility;
        events.update(loser.id, {
          visibility: restored,
          mergedIntoEventId: null,
          updatedAt: at,
          version: loser.version + 1,
        });
        provenance.insertChange({
          eventId: loser.id,
          field: 'visibility',
          oldValueJson: JSON.stringify('MERGED'),
          newValueJson: JSON.stringify(restored),
          cause: 'UNMERGE',
          changedBy: context.actor.id,
          at,
        });
        resolver.apply(loser.id, { cause: 'UNMERGE', at, changedBy: context.actor.id });
        resolver.apply(holder.id, { cause: 'UNMERGE', at, changedBy: context.actor.id });

        // Splitting them is an administrator saying they are different events.
        const pair = candidates.pair(loser.id, parentId);
        if (pair?.status === 'MERGED') {
          candidates.decide(pair, 'REJECTED', context.actor.id, at);
        }
        return { restoredId: loser.id, fromEventId: holder.id };
      },
    );
  }
}
