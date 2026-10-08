import { createHash } from 'node:crypto';

import type {
  TransferCommitRequest,
  TransferPreview,
  TransferRequest,
  TransferResult,
} from '@compintel/contracts';

import { isEmptyPlan, planTransfer, type TransferPlan } from '../../domain/transfer/plan.js';
import { recordAudit, type AuditLog } from '../../platform/audit.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import {
  transferNothingToMove,
  transferPreviewStale,
  transferSameUser,
  transferTargetNotProfessor,
  transferUserNotFound,
} from './errors.js';
import type { TransferRepository, TransferUser } from './repository.js';

/**
 * Ownership transfer (§10.4, D-20, R105, WP-21): an admin previews what moves
 * from one professor to another, then commits it — the plan recomputed and its
 * token compared, so a change since the preview is a 409 and nothing is
 * written. The commit is one transaction: every close and open at one instant,
 * every touched team's and competition's version bumped, one audit row per
 * entity plus a summary, all under one request id. History is never touched.
 */

export interface TransferContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

const studentRef = (id: string): string => `student ${id.slice(-8)}`;

export class TransferService {
  readonly #repo: TransferRepository;
  readonly #audit: AuditLog;
  readonly #clock: Clock;

  constructor(deps: { repo: TransferRepository; audit: AuditLog; clock?: Clock }) {
    this.#repo = deps.repo;
    this.#audit = deps.audit;
    this.#clock = deps.clock ?? systemClock;
  }

  #people(actor: Principal, request: TransferRequest): { from: TransferUser; to: TransferUser } {
    assertCan(actor, 'ownership.transfer');
    if (request.fromUserId === request.toUserId) throw transferSameUser();
    const from = this.#repo.user(request.fromUserId);
    const to = this.#repo.user(request.toUserId);
    if (from === undefined || to === undefined) throw transferUserNotFound();
    // *from* may be disabled — the usual case; *to* must be able to take it on.
    if (to.status !== 'ACTIVE' || !to.roles.includes('PROFESSOR'))
      throw transferTargetNotProfessor();
    return { from, to };
  }

  #plan(from: TransferUser, to: TransferUser): TransferPlan {
    return planTransfer({
      from: { userId: from.id, displayName: from.displayName },
      to: { userId: to.id, displayName: to.displayName },
      teams: this.#repo.teamsOf(from.id),
      competitions: this.#repo.competitionsOf(from.id),
      mentorships: this.#repo.mentorshipsOf(from.id),
      toMentors: this.#repo.menteesOf(to.id),
      now: nowMs(this.#clock),
    });
  }

  #token(from: TransferUser, to: TransferUser, plan: TransferPlan): string {
    return createHash('sha256')
      .update([from.id, to.id, ...plan.tokenParts].join('\n'))
      .digest('hex');
  }

  preview(actor: Principal, request: TransferRequest): TransferPreview {
    const { from, to } = this.#people(actor, request);
    const plan = this.#plan(from, to);
    return {
      from: { userId: from.id, displayName: from.displayName },
      to: { userId: to.id, displayName: to.displayName },
      teams: [...plan.teams],
      competitions: [...plan.competitions],
      mentorships: [...plan.mentorships],
      staysWith: [...plan.staysWith],
      previewToken: this.#token(from, to, plan),
    };
  }

  commit(context: TransferContext, request: TransferCommitRequest): TransferResult {
    const { from, to } = this.#people(context.actor, request);
    return this.#audit.transaction(() => {
      // Recomputed inside the transaction, so nothing can slip in between.
      const plan = this.#plan(from, to);
      if (this.#token(from, to, plan) !== request.previewToken) throw transferPreviewStale();
      if (isEmptyPlan(plan)) throw transferNothingToMove();
      const at = plan.at;
      for (const close of plan.closes) this.#repo.close(close.table, close.rowId, at);
      for (const open of plan.opens) {
        if (open.table === 'team_mentors' && open.role !== null) {
          this.#repo.openTeamMentor(open.entityId, open.userId, open.role, at);
        } else if (open.table === 'engagement_mentors' && open.role !== null) {
          this.#repo.openCompetitionMentor(open.entityId, open.userId, open.role, at);
        } else {
          this.#repo.openMentorship(open.entityId, open.userId, at, context.actor.id);
        }
      }
      for (const id of plan.touchedTeams) this.#repo.bumpTeam(id, at);
      for (const id of plan.touchedCompetitions) this.#repo.bumpCompetition(id, at);
      const base = {
        actorKind: 'USER' as const,
        actorUserId: context.actor.id,
        requestId: context.requestId ?? null,
      };
      const diff = { fromUserId: from.id, toUserId: to.id };
      for (const item of plan.teams) {
        recordAudit(this.#audit, {
          ...base,
          action: 'team.mentors_transferred',
          entityKind: 'team',
          entityId: item.entityId,
          summary: `Moved a team's mentoring from ${from.displayName} to ${to.displayName}`,
          diff,
        });
      }
      for (const item of plan.competitions) {
        recordAudit(this.#audit, {
          ...base,
          action: 'competition.mentors_transferred',
          entityKind: 'competition',
          entityId: item.entityId,
          summary: `Moved a competition's mentoring from ${from.displayName} to ${to.displayName}`,
          diff,
        });
      }
      for (const item of plan.mentorships) {
        recordAudit(this.#audit, {
          ...base,
          action: 'mentorship.transferred',
          entityKind: 'student',
          entityId: item.entityId,
          // R92: the student by a short id, never by name.
          summary: `Moved the mentorship of ${studentRef(item.entityId)} from ${from.displayName} to ${to.displayName}`,
          diff,
        });
      }
      const counts = {
        teams: plan.teams.length,
        competitions: plan.competitions.length,
        mentorships: plan.mentorships.length,
      };
      recordAudit(this.#audit, {
        ...base,
        action: 'ownership.transferred',
        entityKind: 'user',
        entityId: from.id,
        summary: `Transferred ownership from ${from.displayName} to ${to.displayName}`,
        diff: { ...diff, ...counts },
      });
      return { ...counts, auditRows: counts.teams + counts.competitions + counts.mentorships + 1 };
    });
  }
}
