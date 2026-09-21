import type {
  EventCore,
  EventQuery,
  Facets,
  SearchResponse,
  SpellingCorrection,
} from '@compintel/contracts';

import { nowMs, systemClock, APP_TIMEZONE, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { eventNotFound } from '../events/errors.js';
import type { EventsRepository } from '../events/repository.js';
import type { AliasService } from './aliases.js';
import { CursorCodec, type CursorPosition } from './cursor.js';
import { interestCategoryIds } from './domain/interests.js';
import { planQuery, QueryPlanError, type QueryPlan } from './domain/normalize.js';
import { DAY_MS, rank, type RankContext } from './domain/rank.js';
import { aliasWords, expandAliases, ftsMatchExpression, quoteFts } from './domain/text.js';
import { TRIGRAM_MIN_CHARS, trigramMatchExpression } from './domain/trigram.js';
import { correctionMessage } from './domain/typo.js';
import { invalidQuery, parseSearchRequest } from './errors.js';
import type { FacetRepository } from './facets.js';
import { distanceOf, toCore, toListItem, toRankRow, type RankLookups } from './mapping.js';
import type {
  InterestIds,
  SearchExecution,
  SearchRepository,
  SearchRow,
  TextMatch,
} from './repo.js';
import type { RankingThresholds, RankingWeights } from './settings.js';
import type { VocabularyService } from './vocabulary.js';

/**
 * `POST /search/events` and `GET /events/:id` (§8, §16.2).
 *
 * parse (strict, `SEARCH_` codes) → plan (pure) → resolve the text (aliases,
 * then typo correction, reported) → execute → rank (§8.4, pure) → cards with
 * their reasons, plus facets unless the caller said `facets: false`.
 * Visibility (R57, §7.4) is in every statement's base clause, so no path here
 * returns — or counts — a hidden or merged event.
 *
 * RELEVANCE is ordered in `rank.ts`, not SQL: its text part is bm25 normalized
 * against the best hit in the whole result set, so every matching row is read
 * (narrow columns), scored, sorted and paged in memory. The other sorts page
 * in SQL by keyset and are ranked only for the page, to give their reasons.
 */

export interface SearchContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface RankingSettings {
  readonly weights: RankingWeights;
  readonly thresholds: RankingThresholds;
  /** `geography.nearbyRadiusKm`: WITHIN_RADIUS's radius when the query sets none. */
  readonly preferredRadiusKm: number;
}

export interface SearchServiceDependencies {
  readonly repo: SearchRepository;
  readonly facets: FacetRepository;
  readonly events: EventsRepository;
  readonly aliases: AliasService;
  readonly vocabulary: VocabularyService;
  /** Read per query, so a retuned weight applies to the next search. */
  readonly ranking: () => RankingSettings;
  readonly cursors?: CursorCodec;
  readonly clock?: Clock;
  readonly timeZone?: string;
}

interface ResolvedText {
  readonly match: TextMatch;
  readonly usedText: string;
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
    const { query, facets: wantFacets } = parseSearchRequest(body);
    const ranking = this.#deps.ranking();
    const now = nowMs(this.#clock);
    const plan = this.#plan(query, now, ranking);
    const fingerprint = CursorCodec.fingerprint(query);
    const after =
      query.cursor === undefined
        ? undefined
        : this.#cursors.decode(query.cursor, fingerprint, plan.sort.basis);
    const text = plan.text === undefined ? undefined : this.#resolveText(plan.text);
    const interests = this.#interests(context.actor.id);
    const sourceTrust = this.#deps.repo.sourceTrust();
    const trustedMinRank = ranking.thresholds.trustedSourceMinRank;
    const execution: SearchExecution = {
      plan,
      userId: context.actor.id,
      after,
      interests: interests.ids,
      trustedSourceIds: [...sourceTrust]
        .filter(([, source]) => source.trustRank >= trustedMinRank)
        .map(([id]) => id),
      ...(text === undefined ? {} : { text: text.match }),
    };
    const rankContext: RankContext = {
      now,
      timeZone: this.#timeZone,
      weights: ranking.weights,
      thresholds: ranking.thresholds,
      sort: plan.sort.requested,
      text: text?.usedText,
      radiusKm:
        query.maxDistanceKm ?? (plan.campus === undefined ? undefined : ranking.preferredRadiusKm),
      teamSizeFits: query.teamSizeFits,
    };
    const lookups: RankLookups = {
      sources: sourceTrust,
      trustedMinRank,
      categoryNames: interests.categoryNames,
      tagNames: interests.tagNames,
    };
    const rankRow = (row: SearchRow, ctx: RankContext) => rank(toRankRow(row, lookups), ctx);

    let page: { row: SearchRow; ranked: ReturnType<typeof rank> }[];
    let next: CursorPosition | undefined;
    let total: number;
    if (plan.sort.basis === 'SCORE') {
      // Ordered and paged in SQL by `score-sql.ts`; each page row is explained
      // by `rank.ts` from the same inputs, so its reasons sum to the score it
      // was ordered by (asserted in ranking.test.ts).
      const score = {
        now,
        weights: ranking.weights,
        thresholds: ranking.thresholds,
        radiusKm: rankContext.radiusKm,
        teamSizeFits: query.teamSizeFits,
        hasText: execution.text !== undefined,
      };
      const run = (exec: SearchExecution) => this.#deps.repo.relevance(exec, score);
      const rows = run(execution);
      const sliced = rows.slice(0, plan.limit);
      page = sliced.map((row) => ({
        row,
        ranked: rankRow(row, { ...rankContext, bestTextScore: Math.min(0, row.best ?? 0) }),
      }));
      total = rows[0]?.total ?? (after === undefined ? 0 : this.#countAll(execution, run));
      const last = sliced[sliced.length - 1];
      next =
        rows.length > plan.limit && last !== undefined
          ? { nullRank: 0, sortKey: last.sk ?? 0, tie: last.tie ?? null, id: last.id }
          : undefined;
    } else {
      const rows = this.#deps.repo.search(execution);
      const sliced = rows.slice(0, plan.limit);
      page = sliced.map((row) => ({ row, ranked: rankRow(row, rankContext) }));
      total =
        rows[0]?.total ??
        (after === undefined
          ? 0
          : this.#countAll(execution, (exec) => this.#deps.repo.search(exec)));
      const last = sliced[sliced.length - 1];
      next =
        rows.length > plan.limit && last !== undefined
          ? { nullRank: last.nr ?? 0, sortKey: last.sk ?? null, id: last.id }
          : undefined;
    }

    const sources = this.#deps.repo.sourceKeys(page.map((entry) => entry.row.id));
    return {
      items: page.map((entry) =>
        toListItem(entry.row, sources.get(entry.row.id) ?? [], entry.ranked),
      ),
      ...(wantFacets ? { facets: this.#facets(query, plan, execution, ranking, now) } : {}),
      ...(next === undefined
        ? {}
        : { nextCursor: this.#cursors.encode(next, fingerprint, plan.sort.basis) }),
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
      categories: this.#deps.repo.categoriesOf(id),
    });
  }

  get #timeZone(): string {
    return this.#deps.timeZone ?? APP_TIMEZONE;
  }

  #facets(
    query: EventQuery,
    plan: QueryPlan,
    execution: SearchExecution,
    ranking: RankingSettings,
    now: number,
  ): Facets {
    return this.#deps.facets.facets({
      plan,
      userId: execution.userId,
      ...(execution.text === undefined ? {} : { text: execution.text }),
      categories: this.#deps.repo.activeCategories(),
      closingSoonUntil: now + ranking.thresholds.closingSoonDays * DAY_MS,
      options: {
        includeUnknownDeadline: query.includeUnknown?.deadline === true,
        includeOnline: query.modes?.includes('ONLINE') === true,
        includeUnknownLocation: query.includeUnknown?.location === true,
      },
    });
  }

  /** The professor's interests as ids, and the names the reasons print. */
  #interests(userId: string): {
    ids: InterestIds;
    categoryNames: Map<string, string>;
    tagNames: Map<string, string>;
  } {
    const tags = this.#deps.repo.interestTags(userId);
    if (tags.length === 0) {
      return {
        ids: { categoryIds: [], tagIds: [] },
        categoryNames: new Map(),
        tagNames: new Map(),
      };
    }
    const categories = this.#deps.repo.activeCategories();
    return {
      ids: {
        categoryIds: interestCategoryIds(tags, categories),
        tagIds: tags.map((tag) => tag.id),
      },
      categoryNames: new Map(categories.map((category) => [category.id, category.name])),
      tagNames: new Map(tags.map((tag) => [tag.id, tag.name])),
    };
  }

  /** A page past the end carries no `total`; ask again from the top, one row long. */
  #countAll(execution: SearchExecution, run: (execution: SearchExecution) => SearchRow[]): number {
    const rows = run({ ...execution, after: undefined, plan: { ...execution.plan, limit: 0 } });
    return rows[0]?.total ?? 0;
  }

  #plan(query: EventQuery, now: number, ranking: RankingSettings): QueryPlan {
    try {
      return planQuery(query, {
        nowMs: now,
        timeZone: this.#timeZone,
        campus: this.#deps.repo.primaryCampus(),
        closingSoonMs: ranking.thresholds.closingSoonDays * DAY_MS,
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
    const usedText = result.corrected ? words.join(' ') : text.raw;
    return {
      usedText,
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
