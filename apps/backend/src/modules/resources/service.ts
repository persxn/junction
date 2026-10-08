import {
  RESOURCE_OWNER_LABELS,
  isEngagementMentor,
  isEngagementPrimaryMentor,
  type CheckResultsRequest,
  type OwnershipFacts,
  type Resource,
  type ResourceCreateRequest,
  type ResourceGroup,
  type ResourceKind,
  type ResourceList,
  type ResourceUpdateRequest,
} from '@compintel/contracts';

import { isTerminal } from '../../domain/engagements/status.js';
import { CLASSIFY_REFUSAL_TEXT, classify, defaultLabel } from '../../domain/resources/classify.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan, can } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { competitionClosed, competitionNotFound } from '../engagements/errors.js';
import { mentorshipOf } from '../engagements/reader.js';
import type { EngagementRecord, EngagementsRepository } from '../engagements/repository.js';
import {
  resourceInvalidUri,
  resourceNotFound,
  resourceOwnerNotFound,
  resourceVersionConflict,
} from './errors.js';
import type { PlacedResource, ResourceRecord, ResourcesRepository } from './repository.js';

/**
 * A competition's resources (§13, R102–R103, WP-20b): references at every
 * level, added, edited and removed by those who may edit the competition (R96's
 * mentors, or an admin) — each audited, with no link or path in the audit row
 * (R92) — and the shell's check results, which are machine state and neither
 * audited nor versioned (R84). The backend checks shape only: it never fetches
 * a link or looks at a path.
 */

export interface ResourcesDependencies {
  readonly resources: ResourcesRepository;
  readonly engagements: EngagementsRepository;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

export interface ResourcesContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

/** How an audit summary names each kind, mid-sentence. */
const KIND_NOUNS: Readonly<Record<ResourceKind, string>> = {
  URL: 'web link',
  GITHUB: 'GitHub repository',
  CLOUD_DOC: 'cloud document',
  LOCAL_PATH: 'path on a PC',
  OTHER: 'link',
};

const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());

export function toResource(row: ResourceRecord): Resource {
  return {
    id: row.id,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    kind: row.kind,
    label: row.label,
    uri: row.uri,
    machineLabel: row.machineLabel,
    checkStatus: row.checkStatus,
    lastCheckedAt: iso(row.lastCheckedAt),
    addedBy: row.addedByName,
    addedAt: new Date(row.addedAt).toISOString(),
    version: row.version,
  };
}

export class ResourcesService {
  readonly #deps: ResourcesDependencies;
  readonly #clock: Clock;

  constructor(deps: ResourcesDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  #competition(id: string): EngagementRecord {
    const row = this.#deps.engagements.find(id);
    if (row === undefined) throw competitionNotFound();
    return row;
  }

  #facts(actor: Principal, competitionId: string): OwnershipFacts {
    const mentorship = mentorshipOf(this.#deps.engagements.openMentors(competitionId));
    return {
      isCompetitionMentor: isEngagementMentor(actor, mentorship),
      isCompetitionPrimaryMentor: isEngagementPrimaryMentor(actor, mentorship),
    };
  }

  /**
   * May this actor change resources here? A closed competition is read-only
   * (R97), except its outcome: a certificate arrives after it is completed.
   */
  #writable(actor: Principal, competitionId: string, outcome: boolean): void {
    const competition = this.#competition(competitionId);
    assertCan(actor, 'resource.edit', this.#facts(actor, competitionId));
    const closedForThis = outcome ? competition.status !== 'COMPLETED' : true;
    if (isTerminal(competition.status) && closedForThis) {
      throw competitionClosed(competition.status);
    }
  }

  list(actor: Principal, competitionId: string): ResourceList {
    const competition = this.#competition(competitionId);
    assertCan(actor, 'competition.view');
    const groups = new Map<string, ResourceGroup>();
    for (const row of this.#deps.resources.forCompetition(competitionId)) {
      const key = `${row.ownerKind}:${row.ownerId}`;
      const group = groups.get(key) ?? {
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        ownerLabel: ownerLabel(row),
        resources: [],
      };
      groups.set(key, { ...group, resources: [...group.resources, toResource(row)] });
    }
    return {
      competitionId,
      groups: [...groups.values()],
      canEdit:
        !isTerminal(competition.status) &&
        can(actor, 'resource.edit', this.#facts(actor, competitionId)),
    };
  }

  create(context: ResourcesContext, request: ResourceCreateRequest): Resource {
    const competitionId = this.#deps.resources.competitionOf(request.ownerKind, request.ownerId);
    if (competitionId === undefined) throw resourceOwnerNotFound();
    this.#writable(context.actor, competitionId, request.ownerKind === 'OUTCOME');
    const classified = classify(request.uri, request.kind);
    if (!classified.ok) throw resourceInvalidUri(CLASSIFY_REFUSAL_TEXT[classified.refusal]);
    const id = uuid7();
    const at = nowMs(this.#clock);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'resource.added',
        entityKind: 'competition',
        entityId: competitionId,
        // R92: what kind, and where — never the link, the path or its label.
        summary: `Added a ${KIND_NOUNS[classified.kind]} to the ${RESOURCE_OWNER_LABELS[request.ownerKind].toLowerCase()}`,
        diff: {
          resourceId: id,
          kind: classified.kind,
          ownerKind: request.ownerKind,
          ownerId: request.ownerId,
        },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.resources.insert({
          id,
          ownerKind: request.ownerKind,
          ownerId: request.ownerId,
          kind: classified.kind,
          label: request.label ?? defaultLabel(classified.kind, classified.uri),
          uri: classified.uri,
          machineLabel: classified.kind === 'LOCAL_PATH' ? (request.machineLabel ?? null) : null,
          addedBy: context.actor.id,
          addedAt: at,
        });
      },
    );
    return toResource(this.#require(id));
  }

  update(context: ResourcesContext, id: string, request: ResourceUpdateRequest): Resource {
    const current = this.#require(id);
    const competitionId = this.#ownerCompetition(current);
    this.#writable(context.actor, competitionId, current.ownerKind === 'OUTCOME');
    if (current.version !== request.version) throw resourceVersionConflict();
    const targetChanged = request.uri !== undefined || request.kind !== undefined;
    const classified = classify(request.uri ?? current.uri, request.kind ?? current.kind);
    if (!classified.ok) throw resourceInvalidUri(CLASSIFY_REFUSAL_TEXT[classified.refusal]);
    const machineLabel =
      classified.kind !== 'LOCAL_PATH'
        ? null
        : request.machineLabel === undefined
          ? current.machineLabel
          : request.machineLabel;
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'resource.updated',
        entityKind: 'competition',
        entityId: competitionId,
        summary: `Edited a ${KIND_NOUNS[classified.kind]} of the ${RESOURCE_OWNER_LABELS[current.ownerKind].toLowerCase()}`,
        diff: {
          resourceId: id,
          kind: classified.kind,
          fields: Object.keys(request).filter((key) => key !== 'version'),
        },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.resources.update(id, {
          label: request.label ?? current.label,
          uri: classified.uri,
          kind: classified.kind,
          machineLabel,
          resetCheck: targetChanged && classified.uri !== current.uri,
        });
      },
    );
    return toResource(this.#require(id));
  }

  remove(context: ResourcesContext, id: string, version: number): void {
    const current = this.#require(id);
    const competitionId = this.#ownerCompetition(current);
    this.#writable(context.actor, competitionId, current.ownerKind === 'OUTCOME');
    if (current.version !== version) throw resourceVersionConflict();
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'resource.removed',
        entityKind: 'competition',
        entityId: competitionId,
        summary: `Removed a ${KIND_NOUNS[current.kind]} from the ${RESOURCE_OWNER_LABELS[current.ownerKind].toLowerCase()}`,
        diff: { resourceId: id, kind: current.kind },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.resources.delete(id);
      },
    );
  }

  /** R103: what the shell found on this PC — LOCAL_PATH rows only, no audit, no version bump. */
  recordChecks(context: ResourcesContext, request: CheckResultsRequest): number {
    let updated = 0;
    for (const result of request.results) {
      const row = this.#deps.resources.find(result.id);
      if (row?.kind !== 'LOCAL_PATH') continue;
      // Anyone who may read the competition may report what their PC sees.
      this.#competition(this.#ownerCompetition(row));
      assertCan(context.actor, 'competition.view');
      if (this.#deps.resources.recordCheck(row.id, result.status, Date.parse(result.checkedAt))) {
        updated += 1;
      }
    }
    return updated;
  }

  #require(id: string): ResourceRecord {
    const row = this.#deps.resources.find(id);
    if (row === undefined) throw resourceNotFound();
    return row;
  }

  #ownerCompetition(row: ResourceRecord): string {
    const competitionId = this.#deps.resources.competitionOf(row.ownerKind, row.ownerId);
    if (competitionId === undefined) throw resourceOwnerNotFound();
    return competitionId;
  }
}

function ownerLabel(row: PlacedResource): string {
  if (row.ownerKind === 'ENGAGEMENT' || row.ownerKind === 'OUTCOME') {
    return RESOURCE_OWNER_LABELS[row.ownerKind];
  }
  return row.ownerName ?? RESOURCE_OWNER_LABELS[row.ownerKind];
}
