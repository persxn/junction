import {
  ACTIVE_COMPETITION_STATUSES,
  CompetitionQuery,
  EVENT_MODES,
  EVENT_TYPES,
  INSIGHTS_MAX_RANGE_DAYS,
  OUTCOME_RESULTS,
  type InsightsQuery,
  type InsightsResponse,
} from '@compintel/contracts';

import {
  deadlineHit,
  funnel,
  milestones,
  participation,
  streaks,
} from '../../domain/insights/aggregate.js';
import { daysInRange, defaultRange, rangeSpan } from '../../domain/insights/calendar.js';
import { AppError } from '../../platform/errors.js';
import { APP_TIMEZONE, formatDay, nowMs, systemClock, type Clock } from '../../platform/time.js';
import type { Principal } from '../auth/types.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { EngagementInsightsReader } from '../engagements/insights-read.js';
import type { EngagementsModule } from '../engagements/wiring.js';
import { EventInsightsReader } from '../events/insights-read.js';

/**
 * The Insights surface (WP-33, R69, ADR-0019). Everything is a count over
 * stored rows; nothing is estimated. The department view is open (D-03): a
 * professor sees what an administrator sees, so the actor only gates access.
 *
 * `activeNow` is taken from the Competitions list's own code path, exactly as
 * the Dashboard tile is (R107), so the three numbers cannot disagree.
 */

export interface InsightsDependencies {
  readonly engagements: EngagementInsightsReader;
  readonly events: EventInsightsReader;
  readonly competitions: () => EngagementsModule | undefined;
  readonly clock?: Clock;
}

export class InsightsService {
  readonly #deps: InsightsDependencies;
  readonly #clock: Clock;

  constructor(deps: InsightsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  read(actor: Principal, query: InsightsQuery): InsightsResponse {
    const now = nowMs(this.#clock);
    const today = formatDay(APP_TIMEZONE, new Date(now));
    const to = query.to ?? today;
    // Without a start, the twelve months up to the end.
    const from = query.from ?? defaultRange(to).from;
    if (from > to || daysInRange(from, to) > INSIGHTS_MAX_RANGE_DAYS) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        status: 400,
        title: 'That date range cannot be shown',
        detail: `Choose a start on or before the end, at most ${String(INSIGHTS_MAX_RANGE_DAYS)} days apart.`,
      });
    }
    const span = rangeSpan(from, to);
    const range = { from, to, span };
    const reader = this.#deps.engagements;
    const history = reader.history();
    const created = reader.created(span);

    const competitions = this.#deps.competitions();
    if (competitions === undefined)
      throw new Error('competitions are not available on this backend');
    const activeNow = competitions.records.list(
      { actor },
      CompetitionQuery.parse({ status: ACTIVE_COMPETITION_STATUSES.join(',') }),
    ).total;

    const byType = new Map(reader.eventsByType(span).map((row) => [row.type, row.count]));
    const byMode = new Map(reader.eventsByMode(span).map((row) => [row.mode, row.count]));
    const byResult = new Map(reader.outcomes(span).map((row) => [row.result, row.count]));

    return {
      from,
      to,
      isEmpty: !reader.hasAny(),
      activeNow,
      participation: participation(history, range, now),
      eventsByType: EVENT_TYPES.map((type) => ({ type, count: byType.get(type) ?? 0 })).filter(
        (row) => row.count > 0,
      ),
      eventsByMode: EVENT_MODES.map((mode) => ({ mode, count: byMode.get(mode) ?? 0 })).filter(
        (row) => row.count > 0,
      ),
      funnel: funnel(created, history),
      outcomes: OUTCOME_RESULTS.map((result) => ({ result, count: byResult.get(result) ?? 0 })),
      students: reader.students(span),
      teams: reader.teams(span),
      mentors: reader.mentors(span),
      deadlines: deadlineHit(reader.stages(span), span, now),
      sources: this.#deps.events.sources(span),
      streaks: streaks(history, range, now),
      milestones: milestones(history, reader.winnerTimes(), now),
    };
  }
}

/** The service over one database, as `main.ts` and the test harness wire it. */
export function createInsightsService(
  db: DatabaseHandle,
  competitions: () => EngagementsModule | undefined,
  clock?: Clock,
): InsightsService {
  return new InsightsService({
    engagements: new EngagementInsightsReader(db),
    events: new EventInsightsReader(db),
    competitions,
    ...(clock === undefined ? {} : { clock }),
  });
}
