import type {
  CandidateSeries,
  DedupConfig,
  EventCandidate,
  MatchMethod,
} from '@compintel/contracts';

import type { SourceRecordRow, SourceRow } from '../../db/schema/index.js';
import {
  assess,
  DEADLINE_WINDOW_MS,
  START_WINDOW_MS,
  urlSpellings,
  type DedupSubject,
} from '../../domain/dedup/index.js';
import { alternateClaimValues, claimValues } from '../../domain/events/claims.js';
import { asCandidateSeries, detectSeries } from '../../domain/series/index.js';
import { normalizeTitle } from '../../domain/normalize/text.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import type { Geocoder } from '../geo/geocoder.js';
import type { DedupCandidatesRepository } from './dedup-repository.js';
import type { ProvenanceRepository } from './provenance.js';
import type { EventsRepository, NewDeadline } from './repository.js';
import type { EventResolver } from './resolver.js';
import type { SeriesRepository } from './series.js';

/**
 * `source_records` → `events` (§7's pipeline after normalization; §7.5).
 *
 * Called from the scrape's per-item transaction, after the record has been
 * upserted. A record already linked to an event updates that event's claims
 * and re-resolves it. A record seen for the first time is matched: §7.5's
 * candidates are scored, R64's edition guard is asked first, and the record
 * either joins an existing event (AUTO_MERGE), or becomes a new one — with a
 * PENDING review row for every candidate in the grey band.
 *
 * A POLICY_HIDDEN event links and keeps its claims like any other: visibility
 * decides what a professor sees, never what we remember.
 */

export interface LinkInput {
  readonly record: SourceRecordRow;
  readonly candidate: EventCandidate;
  readonly source: SourceRow;
  readonly at: number;
}

export type LinkOutcome = 'UPDATED' | 'AUTO_MERGED' | 'CREATED';

export interface LinkResult {
  readonly eventId: string;
  readonly outcome: LinkOutcome;
  readonly matchMethod: MatchMethod;
  readonly matchScore: number | null;
  /** Ids of PENDING `dedup_candidates` rows this link raised. */
  readonly candidateIds: readonly string[];
}

export interface EventLinkerDependencies {
  readonly events: EventsRepository;
  readonly provenance: ProvenanceRepository;
  readonly candidates: DedupCandidatesRepository;
  readonly resolver: EventResolver;
  readonly geocoder: Pick<Geocoder, 'resolve'>;
  readonly audit: AuditLog;
  /** R65: read at call time, so a retuned setting applies to the next item. */
  readonly dedupConfig: () => DedupConfig;
  /** WP-11: series upsert and `events.series_id`. */
  readonly series: SeriesRepository;
}

/**
 * The series a candidate belongs to: the adapter's verdict when it could see
 * the whole listing, otherwise `domain/series` on the candidate alone — which
 * still recognises yearly editions and titled rounds.
 */
function seriesOf(candidate: EventCandidate): CandidateSeries | undefined {
  if (candidate.series !== undefined) {
    return candidate.series;
  }
  let resource: string | undefined;
  try {
    resource =
      candidate.officialUrl === undefined ? undefined : new URL(candidate.officialUrl).hostname;
  } catch {
    resource = undefined;
  }
  return asCandidateSeries(
    detectSeries({
      title: candidate.title,
      eventType: candidate.eventType.value,
      resource,
      startsAt: candidate.startsAt?.at,
    }),
  );
}

function deadlinesOf(candidate: EventCandidate): NewDeadline[] {
  return [
    ...(candidate.registrationDeadlineAt === undefined
      ? []
      : [
          {
            kind: 'REGISTRATION' as const,
            label: 'Registration closes',
            dueAt: candidate.registrationDeadlineAt.at,
            precision: candidate.registrationDeadlineAt.precision,
          },
        ]),
    ...(candidate.deadlines ?? []).map((deadline) => ({
      kind: deadline.kind,
      label: deadline.label,
      dueAt: deadline.dueAt,
      precision: deadline.precision,
    })),
  ];
}

export class EventLinker {
  readonly #deps: EventLinkerDependencies;

  constructor(deps: EventLinkerDependencies) {
    this.#deps = deps;
  }

  link(input: LinkInput): LinkResult {
    const result = this.#link(input);
    // WP-11: the series verdict also decides the round flag this record claims,
    // so a title-pattern guess can never disagree with the series it is in.
    const series = seriesOf(input.candidate);
    if (series !== undefined) {
      this.#deps.series.assign(
        result.eventId,
        series,
        input.candidate.organizerName ?? null,
        input.at,
      );
    }
    return result;
  }

  #link(input: LinkInput): LinkResult {
    const { record, at } = input;
    const series = seriesOf(input.candidate);
    const candidate: EventCandidate = {
      ...input.candidate,
      isRecurringRound: series?.isRecurringRound ?? false,
    };
    const { events, provenance } = this.#deps;
    const place = this.#deps.geocoder.resolve(candidate.place);
    const values = claimValues(candidate, place);
    const alternates = alternateClaimValues(candidate);

    const writeProvenance = (eventId: string): void => {
      provenance.upsertClaims(eventId, record.id, values, alternates, at);
      provenance.syncDeadlines(eventId, record.id, deadlinesOf(candidate), at);
    };

    // ---- Already linked: update and re-resolve ---------------------------------
    const linked = record.eventId === null ? undefined : events.getById(record.eventId);
    if (linked !== undefined) {
      writeProvenance(linked.id);
      this.#deps.resolver.apply(linked.id, { cause: 'SCRAPE', at, sourceRecordId: record.id });
      return {
        eventId: linked.id,
        outcome: 'UPDATED',
        matchMethod: record.matchMethod,
        matchScore: record.matchScore,
        candidateIds: [],
      };
    }

    // ---- First sighting: match (§7.5) -------------------------------------------
    const subject: DedupSubject = {
      title: candidate.title,
      organizerName: candidate.organizerName,
      editionYear: candidate.editionYear,
      startsAt: candidate.startsAt?.at,
      registrationDeadlineAt: candidate.registrationDeadlineAt?.at,
      mode: candidate.mode.value,
      city: place.city ?? candidate.place?.city,
      countryCode: place.countryCode ?? candidate.place?.countryCode,
      officialUrl: candidate.officialUrl,
      registrationUrl: candidate.registrationUrl,
    };
    const slice = events.candidateSlice({
      startsAt: subject.startsAt ?? undefined,
      registrationDeadlineAt: subject.registrationDeadlineAt ?? undefined,
      startWindowMs: START_WINDOW_MS,
      deadlineWindowMs: DEADLINE_WINDOW_MS,
      urls: [...urlSpellings(candidate.officialUrl), ...urlSpellings(candidate.registrationUrl)],
    });
    const assessments = assess(
      subject,
      slice,
      this.#deps.dedupConfig(),
      (a, b) => a.firstSeenAt - b.firstSeenAt || (a.id < b.id ? -1 : 1),
    );
    const best = assessments[0];

    if (best?.decision === 'AUTO_MERGE') {
      const target = best.target;
      const method: MatchMethod = best.score.features.urlMatch ? 'URL' : 'AUTO_SCORE';
      return withAudit(
        this.#deps.audit,
        {
          actorKind: 'SYSTEM',
          actorUserId: null,
          action: 'event.auto_merged',
          entityKind: 'event',
          entityId: target.id,
          summary: `${candidate.title} from ${input.source.key} joined ${target.title}`,
          diff: {
            sourceKey: input.source.key,
            externalKey: record.externalKey,
            method,
            score: best.score.total,
            features: best.score.features,
          },
        },
        (): LinkResult => {
          writeProvenance(target.id);
          provenance.linkRecord(record.id, target.id, method, best.score.total);
          this.#deps.resolver.apply(target.id, { cause: 'SCRAPE', at, sourceRecordId: record.id });
          return {
            eventId: target.id,
            outcome: 'AUTO_MERGED',
            matchMethod: method,
            matchScore: best.score.total,
            candidateIds: [],
          };
        },
      );
    }

    const grey = assessments.filter((assessment) => assessment.decision === 'CANDIDATE');
    return withAudit(
      this.#deps.audit,
      (result: LinkResult) => ({
        actorKind: 'SYSTEM' as const,
        actorUserId: null,
        action: 'event.created',
        entityKind: 'event',
        entityId: result.eventId,
        summary: `${candidate.title} from ${input.source.key}`,
        diff: {
          sourceKey: input.source.key,
          externalKey: record.externalKey,
          possibleDuplicates: result.candidateIds.length,
        },
      }),
      (): LinkResult => {
        const eventId = events.insert({
          title: candidate.title,
          normalizedTitle: normalizeTitle(candidate.title),
          eventType: candidate.eventType.value,
          isRecurringRound: candidate.isRecurringRound,
          visibility: 'VISIBLE',
          qualityScore: 0,
          firstSeenAt: record.firstSeenAt,
          lastChangedAt: at,
          createdAt: at,
          updatedAt: at,
        });
        writeProvenance(eventId);
        provenance.linkRecord(record.id, eventId, 'NEW', null);
        this.#deps.resolver.apply(eventId, {
          cause: 'SCRAPE',
          at,
          sourceRecordId: record.id,
          creating: true,
        });
        const candidateIds = grey
          .map((assessment) =>
            this.#deps.candidates.insertIfAbsent(
              eventId,
              assessment.target.id,
              assessment.score.total,
              assessment.score.features,
              at,
            ),
          )
          .filter((row) => row !== undefined)
          .map((row) => row.id);
        return { eventId, outcome: 'CREATED', matchMethod: 'NEW', matchScore: null, candidateIds };
      },
    );
  }
}
