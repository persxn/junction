import {
  OUTCOME_RESULT_LABELS,
  isEngagementMentor,
  isEngagementPrimaryMentor,
  type OutcomeInput,
  type OutcomeView,
  type OwnershipFacts,
} from '@compintel/contracts';

import { canRecord, recordBlockedReason, validateOutcome } from '../../domain/outcomes/validate.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { competitionNotFound } from '../engagements/errors.js';
import { mentorshipOf } from '../engagements/reader.js';
import type { EngagementRecord } from '../engagements/repository.js';
import type { EngagementsModule } from '../engagements/wiring.js';
import { toResource } from '../resources/service.js';
import type { ResourcesRepository } from '../resources/repository.js';
import type { ResourcesModule } from '../resources/wiring.js';
import {
  outcomeInvalid,
  outcomeNotAllowed,
  outcomeNotFound,
  outcomeVersionConflict,
} from './errors.js';
import type { OutcomeRecord, OutcomesRepository } from './repository.js';

/**
 * A competition's outcome (R104, WP-21): recorded once it has happened — from
 * PARTICIPATING the same unit of work moves it to COMPLETED through WP-19's
 * machine, history row and all — then edited in place or removed, each
 * audited. The certificate is an OUTCOME resource, existing or added here.
 */

/** An outcome row as the page shows it, its certificate resolved. */
export function toOutcomeView(row: OutcomeRecord, resources: ResourcesRepository): OutcomeView {
  const certificate =
    row.certificateResourceId === null ? undefined : resources.find(row.certificateResourceId);
  return {
    competitionId: row.engagementId,
    result: row.result,
    rank: row.rank,
    prizeText: row.prizeText,
    prizeMinor: row.prizeMinor,
    prizeCurrency: row.prizeCurrency,
    certificate: certificate === undefined ? null : toResource(certificate),
    resultUrl: row.resultUrl,
    notes: row.notes,
    feedback: row.feedback,
    recordedBy: row.recordedByName,
    recordedAt: new Date(row.recordedAt).toISOString(),
    version: row.version,
  };
}

export interface OutcomesDependencies {
  readonly outcomes: OutcomesRepository;
  readonly competitions: EngagementsModule;
  readonly resources: ResourcesModule;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export interface OutcomesContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export class OutcomesService {
  readonly #deps: OutcomesDependencies;
  readonly #clock: Clock;

  constructor(deps: OutcomesDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  /** The page's panel; null before one is recorded. */
  view(competitionId: string): OutcomeView | null {
    const row = this.#deps.outcomes.find(competitionId);
    return row === undefined ? null : this.#toView(row);
  }

  #toView(row: OutcomeRecord): OutcomeView {
    return toOutcomeView(row, this.#deps.resources.repository);
  }

  #competition(id: string): EngagementRecord {
    const row = this.#deps.competitions.repository.find(id);
    if (row === undefined) throw competitionNotFound();
    return row;
  }

  #allowed(actor: Principal, competition: EngagementRecord): void {
    const mentorship = mentorshipOf(this.#deps.competitions.repository.openMentors(competition.id));
    const facts: OwnershipFacts = {
      isCompetitionMentor: isEngagementMentor(actor, mentorship),
      isCompetitionPrimaryMentor: isEngagementPrimaryMentor(actor, mentorship),
    };
    assertCan(actor, 'outcome.record', facts);
  }

  /** `PUT /competitions/:id/outcome`: record the first time, or edit in place. */
  record(context: OutcomesContext, competitionId: string, input: OutcomeInput): OutcomeView {
    const competition = this.#competition(competitionId);
    this.#allowed(context.actor, competition);
    if (!canRecord(competition.status)) {
      throw outcomeNotAllowed(recordBlockedReason(competition.status) ?? 'Not now.');
    }
    const validated = validateOutcome(input);
    if (!validated.ok) throw outcomeInvalid(validated.problem);
    const existing = this.#deps.outcomes.find(competitionId);
    if ((existing?.version ?? undefined) !== input.version) throw outcomeVersionConflict();
    if (
      input.certificate !== undefined &&
      input.certificate !== null &&
      'resourceId' in input.certificate
    ) {
      const resource = this.#deps.resources.repository.find(input.certificate.resourceId);
      if (resource?.ownerKind !== 'OUTCOME' || resource.ownerId !== competitionId) {
        throw outcomeInvalid('That certificate is not one of this outcome’s resources.');
      }
    }
    const at = nowMs(this.#clock);
    const summary =
      existing === undefined
        ? `Recorded the outcome: ${OUTCOME_RESULT_LABELS[validated.value.result]}`
        : `Edited the outcome: ${OUTCOME_RESULT_LABELS[validated.value.result]}`;
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: existing === undefined ? 'outcome.recorded' : 'outcome.updated',
        entityKind: 'competition',
        entityId: competitionId,
        summary,
        diff: { result: validated.value.result, rank: validated.value.rank },
        requestId: context.requestId ?? null,
      },
      () => {
        if (competition.status === 'PARTICIPATING') {
          // R104: the same unit of work completes it, through the status machine.
          this.#deps.competitions.records.transition(context, competitionId, {
            to: 'COMPLETED',
            version: competition.version,
          });
        }
        const certificateResourceId = this.#certificate(context, competitionId, input, existing);
        if (existing === undefined) {
          this.#deps.outcomes.insert({
            ...validated.value,
            engagementId: competitionId,
            certificateResourceId,
            recordedBy: context.actor.id,
            recordedAt: at,
          });
        } else {
          this.#deps.outcomes.update(competitionId, { ...validated.value, certificateResourceId });
        }
      },
    );
    const saved = this.#deps.outcomes.find(competitionId);
    if (saved === undefined) throw outcomeNotFound();
    return this.#toView(saved);
  }

  #certificate(
    context: OutcomesContext,
    competitionId: string,
    input: OutcomeInput,
    existing: OutcomeRecord | undefined,
  ): string | null {
    const given = input.certificate;
    if (given === undefined) return existing?.certificateResourceId ?? null;
    if (given === null) return null;
    if ('resourceId' in given) return given.resourceId;
    return this.#deps.resources.service.create(context, {
      ownerKind: 'OUTCOME',
      ownerId: competitionId,
      uri: given.uri,
      ...(given.kind === undefined ? {} : { kind: given.kind }),
      label: given.label ?? 'Certificate',
      ...(given.machineLabel === undefined ? {} : { machineLabel: given.machineLabel }),
    }).id;
  }

  /** `DELETE /competitions/:id/outcome`: audited; the competition stays COMPLETED. */
  remove(context: OutcomesContext, competitionId: string, version: number): void {
    const competition = this.#competition(competitionId);
    this.#allowed(context.actor, competition);
    const existing = this.#deps.outcomes.find(competitionId);
    if (existing === undefined) throw outcomeNotFound();
    if (existing.version !== version) throw outcomeVersionConflict();
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'outcome.removed',
        entityKind: 'competition',
        entityId: competitionId,
        summary: 'Removed the outcome',
        diff: { result: existing.result },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.outcomes.delete(competitionId);
      },
    );
  }
}
