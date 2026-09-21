import type {
  EventCore,
  EventListItem,
  SearchResponse,
  SpellingCorrection,
} from '@compintel/contracts';

import type { EventRow } from '../../db/schema/index.js';
import { haversineKm } from '../../domain/geo/distance.js';
import { nowMs, systemClock, APP_TIMEZONE, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { eventNotFound } from '../events/errors.js';
import type { EventsRepository } from '../events/repository.js';
import type { AliasService } from './aliases.js';
import { CursorCodec } from './cursor.js';
import { planQuery, QueryPlanError, type QueryPlan } from './domain/normalize.js';
import { aliasWords, expandAliases, ftsMatchExpression, quoteFts } from './domain/text.js';
import { TRIGRAM_MIN_CHARS, trigramMatchExpression } from './domain/trigram.js';
import { correctionMessage } from './domain/typo.js';
import { invalidQuery, parseEventQuery } from './errors.js';
import type { SearchExecution, SearchRepository, SearchRow, TextMatch } from './repo.js';
import type { VocabularyService } from './vocabulary.js';

/**
 * `POST /search/events` and `GET /events/:id` (§8, §16.2).
 *
 * The order of operations is the design: parse (strict, `SEARCH_` codes) →
 * plan (pure: dates, unknowns, distance, sort) → resolve the text (aliases,
 * then typo correction for zero-hit words, reported) → execute (one SQL
 * statement) → map to cards. Visibility (R57, §7.4) is in the SQL's base
 * clause, so no path through here can return a hidden or merged event.
 */

export interface SearchContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface SearchServiceDependencies {
  readonly repo: SearchRepository;
  readonly events: EventsRepository;
  readonly aliases: AliasService;
  readonly vocabulary: VocabularyService;
  readonly cursors?: CursorCodec;
  readonly clock?: Clock;
  readonly timeZone?: string;
}

/** A ready text match, plus the correction to report if one was made. */
interface ResolvedText {
  readonly match: TextMatch;
  readonly correction?: SpellingCorrection;
}

export class SearchService {
  readonly #deps: SearchServiceDependencies;
  readonly #cursors: CursorCodec;
  readonly #clock: Clock;

  constructor(deps: SearchServiceDependencies) {
    this.#deps = deps;
    this.#cursors = deps.cursors ?? new CursorCodec();
    this.#clock = deps.clock ?? systemClock;
  }

  search(context: SearchContext, body: unknown): SearchResponse {
    assertCan(context.actor, 'event.view');
    const query = parseEventQuery(body);
    if (query.categories !== undefined || query.tags !== undefined) {
      // Neither is stored yet: categories arrive with WP-15b, tags have no table.
      // Answering as if the filter applied would show results it never filtered.
      throw invalidQuery('Filtering by category or tag is not available yet.');
    }
    const plan = this.#plan(query);
    const fingerprint = CursorCodec.fingerprint(query);
    const after =
      query.cursor === undefined
        ? undefined
        : this.#cursors.decode(query.cursor, fingerprint, plan.sort.basis);
    const text = plan.text === undefined ? undefined : this.#resolveText(plan.text);

    const execution = {
      plan,
      userId: context.actor.id,
      after,
      ...(text === undefined ? {} : { text: text.match }),
    };
    const rows = this.#deps.repo.search(execution);
    const page = rows.slice(0, plan.limit);
    const last = page[page.length - 1];
    const total = rows[0]?.total ?? (after === undefined ? 0 : this.#countAll(execution));
    const sources = this.#deps.repo.sourceKeys(page.map((row) => row.id));

    return {
      items: page.map((row) => toListItem(row, sources.get(row.id) ?? [])),
      ...(rows.length > plan.limit && last !== undefined
        ? {
            nextCursor: this.#cursors.encode(
              { nullRank: last.nr, sortKey: last.sk, id: last.id },
              fingerprint,
              plan.sort.basis,
            ),
          }
        : {}),
      total,
      totalIsApproximate: false,
      ...(text?.correction === undefined ? {} : { correction: text.correction }),
    };
  }

  /** The core event (WP-16b adds provenance, conflicts and history on top). */
  detail(context: SearchContext, id: string): EventCore {
    assertCan(context.actor, 'event.view');
    const event = this.#deps.events.getVisibleEventById(id);
    if (event === undefined) {
      throw eventNotFound(id);
    }
    const campus = this.#deps.repo.primaryCampus();
    return toCore(event, {
      distanceKm: campus === undefined ? null : distanceOf(event, campus),
      deadlines: this.#deps.events.deadlinesOf(id).map((deadline) => ({
        id: deadline.id,
        kind: deadline.kind,
        label: deadline.label,
        dueAt: deadline.dueAt,
        precision: deadline.precision,
        origin: deadline.origin,
      })),
      sources: this.#deps.repo.sourcesOf(id),
    });
  }

  /** A page past the end carries no `total`; ask again from the top, one row long. */
  #countAll(execution: SearchExecution): number {
    const rows = this.#deps.repo.search({
      ...execution,
      after: undefined,
      plan: { ...execution.plan, limit: 0 },
    });
    return rows[0]?.total ?? 0;
  }

  #plan(query: Parameters<typeof planQuery>[0]): QueryPlan {
    try {
      return planQuery(query, {
        nowMs: nowMs(this.#clock),
        timeZone: this.#deps.timeZone ?? APP_TIMEZONE,
        campus: this.#deps.repo.primaryCampus(),
      });
    } catch (error) {
      if (error instanceof QueryPlanError) {
        throw invalidQuery(error.message);
      }
      throw error;
    }
  }

  /**
   * Aliases first (their words are never "corrected"), then F5/A5's typo step
   * for words with no hit in either index, then the two MATCH expressions.
   */
  #resolveText(text: NonNullable<QueryPlan['text']>): ResolvedText {
    const aliases = this.#deps.aliases.index();
    const protectedWords = aliasWords(expandAliases(text.words, aliases));
    const hasHits = (word: string): boolean =>
      this.#deps.repo.hasVisibleHit('event_fts', quoteFts(word)) ||
      ([...word].length >= TRIGRAM_MIN_CHARS &&
        this.#deps.repo.hasVisibleHit('event_fts_trigram', quoteFts(word)));
    const result = this.#deps.vocabulary.correct(text.words, protectedWords, hasHits);
    const words = result.corrected ? result.words : text.words;
    const usedText = words.join(' ');
    return {
      match: {
        fts: ftsMatchExpression(expandAliases(words, aliases)),
        trigram: result.corrected ? trigramMatchExpression(usedText) : (text.trigram ?? undefined),
      },
      ...(result.corrected
        ? {
            correction: {
              searchedTerm: text.words.join(' '),
              usedTerm: usedText,
              message: correctionMessage(text.words.join(' '), usedText),
            },
          }
        : {}),
    };
  }
}

function toListItem(row: SearchRow, sources: string[]): EventListItem {
  return {
    id: row.id,
    title: row.title,
    organizerName: row.organizer_name,
    eventType: row.event_type,
    mode: row.mode,
    distanceKm: row.distance_km,
    registrationDeadlineAt: row.registration_deadline_at,
    registrationDeadlinePrecision: row.registration_deadline_precision,
    startsAt: row.starts_at,
    datePrecision: row.date_precision,
    prize: {
      text: row.prize_text,
      totalMinor: row.prize_total_minor,
      currency: row.prize_currency,
    },
    teamMin: row.team_min,
    teamMax: row.team_max,
    sources,
    hasConflicts: row.has_conflicts === 1,
  };
}

/** The same rule the list uses: no distance to an online event or a coarse coordinate. */
function distanceOf(event: EventRow, campus: { lat: number; lon: number }): number | null {
  const precise = ['EXACT', 'INSTITUTION', 'CITY'].includes(event.geoPrecision);
  if (event.mode === 'ONLINE' || !precise || event.lat === null || event.lon === null) {
    return null;
  }
  return haversineKm(campus, { lat: event.lat, lon: event.lon });
}

function toCore(
  event: EventRow,
  extra: Pick<EventCore, 'distanceKm' | 'deadlines' | 'sources'>,
): EventCore {
  return {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    mode: event.mode,
    organizerName: event.organizerName,
    organizerKind: event.organizerKind,
    city: event.city,
    countryCode: event.countryCode,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    registrationDeadlineAt: event.registrationDeadlineAt,
    registrationDeadlinePrecision: event.registrationDeadlinePrecision,
    datePrecision: event.datePrecision,
    feeKnown: event.feeKnown,
    feeMinor: event.feeMinor,
    feeCurrency: event.feeCurrency,
    teamMin: event.teamMin,
    teamMax: event.teamMax,
    editionYear: event.editionYear,
    isRecurringRound: event.isRecurringRound,
    cancellation: event.cancellation,
    visibility: event.visibility,
    qualityScore: event.qualityScore,
    hasConflicts: event.hasConflicts,
    officialUrl: event.officialUrl,
    normalizedTitle: event.normalizedTitle,
    seriesId: event.seriesId,
    hostInstitutionId: event.hostInstitutionId,
    summary: event.summary,
    descriptionMd: event.descriptionMd,
    prizeText: event.prizeText,
    prizeTotalMinor: event.prizeTotalMinor,
    prizeCurrency: event.prizeCurrency,
    eligibilityText: event.eligibilityText,
    requirementsText: event.requirementsText,
    submissionRequirementsText: event.submissionRequirementsText,
    venueName: event.venueName,
    state: event.state,
    lat: event.lat,
    lon: event.lon,
    geoPrecision: event.geoPrecision,
    timezone: event.timezone,
    registrationOpensAt: event.registrationOpensAt,
    submissionDeadlineAt: event.submissionDeadlineAt,
    feeText: event.feeText,
    registrationUrl: event.registrationUrl,
    cancellationOrigin: event.cancellationOrigin,
    mergedIntoEventId: event.mergedIntoEventId,
    policyReason: event.policyReason,
    lastVerifiedAt: event.lastVerifiedAt,
    lastChangedAt: event.lastChangedAt,
    firstSeenAt: event.firstSeenAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    version: event.version,
    categories: [],
    ...extra,
  };
}
