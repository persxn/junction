import {
  ENGAGEMENT_STATUS_LABELS,
  type CompetitionDetail,
  type CompetitionListResponse,
  type CompetitionQuery,
  type CompetitionUpdateRequest,
  type TransitionRequest,
} from '@compintel/contracts';

import { canTransition, closesRoster } from '../../domain/engagements/status.js';
import { withAudit } from '../../platform/audit.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import { competitionVersionConflict, invalidTransition } from './errors.js';
import {
  EngagementReader,
  type EngagementsContext,
  type EngagementsDependencies,
} from './reader.js';

/**
 * Competition records (§6.2, R96–R97): the list, the page, notes, and the
 * status machine. Every status change writes its history row and its audit
 * row in one transaction; a refused move writes nothing.
 */
export class EngagementsService {
  readonly #deps: EngagementsDependencies;
  readonly #clock: Clock;
  readonly #reader: EngagementReader;

  constructor(deps: EngagementsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new EngagementReader(deps);
  }

  list(context: EngagementsContext, query: CompetitionQuery): CompetitionListResponse {
    assertCan(context.actor, 'competition.view');
    const rows = this.#deps.engagements.list(query, context.actor.id, nowMs(this.#clock));
    const items = this.#reader.list(context.actor, rows);
    return { items, total: items.length };
  }

  get(context: EngagementsContext, id: string): CompetitionDetail {
    assertCan(context.actor, 'competition.view');
    return this.#reader.detail(context.actor, id);
  }

  update(
    context: EngagementsContext,
    id: string,
    request: CompetitionUpdateRequest,
  ): CompetitionDetail {
    this.#reader.require(id);
    assertCan(context.actor, 'competition.edit', this.#reader.facts(context.actor, id));
    this.#reader.requireEditable(id, request.version);
    const notes = request.notes === null || request.notes.trim() === '' ? null : request.notes;
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'competition.notes_changed',
        entityKind: 'competition',
        entityId: id,
        summary: 'Edited a competition’s notes',
        // The notes may name students; the audit records only that they changed.
        diff: { notes: notes === null ? 'cleared' : 'changed' },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.engagements.touch(id, nowMs(this.#clock), { notes });
      },
    );
    return this.#reader.detail(context.actor, id);
  }

  /**
   * R97: one move along the table. Refused → 409 with the allowed list and
   * nothing written. Entering WITHDRAWN or NOT_SELECTED releases the roster;
   * entering ASSIGNED runs the `onAssigned` hooks — both in the same transaction.
   */
  transition(
    context: EngagementsContext,
    id: string,
    request: TransitionRequest,
  ): CompetitionDetail {
    const row = this.#reader.require(id);
    assertCan(context.actor, 'competition.edit', this.#reader.facts(context.actor, id));
    if (row.version !== request.version) throw competitionVersionConflict();
    if (!canTransition(row.status, request.to)) throw invalidTransition(row.status, request.to);
    const at = nowMs(this.#clock);
    const note =
      request.note === undefined || request.note === null || request.note === ''
        ? null
        : request.note;
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'competition.status_changed',
        entityKind: 'competition',
        entityId: id,
        summary: `Moved a competition from ${ENGAGEMENT_STATUS_LABELS[row.status]} to ${ENGAGEMENT_STATUS_LABELS[request.to]}`,
        diff: { from: row.status, to: request.to },
        requestId: context.requestId ?? null,
      },
      () => {
        const repo = this.#deps.engagements;
        repo.touch(id, at, { status: request.to });
        repo.addHistory({
          id: uuid7(),
          engagementId: id,
          from: row.status,
          to: request.to,
          by: context.actor.id,
          at,
          note,
        });
        if (closesRoster(request.to)) repo.closeRoster(id, at);
        if (request.to === 'ASSIGNED') {
          for (const hook of this.#deps.onAssigned) {
            hook({ engagementId: id, eventId: row.eventId, actorId: context.actor.id, at });
          }
        }
      },
    );
    return this.#reader.detail(context.actor, id);
  }
}
