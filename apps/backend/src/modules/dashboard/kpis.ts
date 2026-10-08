import {
  ACTIVE_COMPETITION_STATUSES,
  CLOSING_SOON_REGISTRATION,
  CompetitionQuery,
  DeadlineQuery,
  KPI_LABELS,
  type KpiLink,
  type KpiResponse,
  type KpiScope,
  type KpiTile,
} from '@compintel/contracts';

import { formatDay, nowMs, systemClock, type Clock } from '../../platform/time.js';
import { BUCKET_ZONE } from '../../domain/deadlines/buckets.js';
import type { Principal } from '../auth/types.js';
import type { DeadlinesModule } from '../deadlines/wiring.js';
import type { EngagementsModule } from '../engagements/wiring.js';
import type { SearchModule } from '../search/wiring.js';

/**
 * The Dashboard's KPI strip (§16.2, R107, WP-22). Each tile is defined once,
 * as the filter of the list it opens — `link` — and its number is that list's
 * own total, computed by that list's own code path: the search module for the
 * Discover tiles, WP-19's list for competitions, the Radar for overdue tasks.
 * Nothing here counts anything itself.
 */

export interface KpiDependencies {
  readonly search: () => SearchModule | undefined;
  readonly competitions: () => EngagementsModule | undefined;
  readonly deadlines: () => DeadlinesModule | undefined;
  readonly clock?: Clock;
}

/** What Discover's "All events" tab sends for a set of chips (its `effectiveQuery`). */
export function allEventsQuery(filters: Record<string, unknown>): Record<string, unknown> {
  return { ...filters, excludeHidden: true, sort: 'DEADLINE', limit: 1, facets: false };
}

const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not available on this backend`);
  return value;
};

export class KpiService {
  readonly #deps: KpiDependencies;
  readonly #clock: Clock;

  constructor(deps: KpiDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  #discover(
    actor: Principal,
    key: 'UPCOMING_EVENTS' | 'CLOSING_SOON',
    filters: Record<string, unknown>,
  ): KpiTile {
    const answer = need(this.#deps.search(), 'search').service.search(
      { actor },
      allEventsQuery(filters),
    );
    const link: KpiLink = { to: '/discover', search: { tab: 'all', view: 'recommended', filters } };
    return {
      key,
      label: KPI_LABELS[key],
      value: answer.total,
      totalIsApproximate: answer.totalIsApproximate,
      link,
    };
  }

  tiles(actor: Principal, scope: KpiScope): KpiResponse {
    const today = formatDay(BUCKET_ZONE, new Date(nowMs(this.#clock)));
    const upcoming = this.#discover(actor, 'UPCOMING_EVENTS', { eventDate: { from: today } });
    const closing = this.#discover(actor, 'CLOSING_SOON', {
      registration: CLOSING_SOON_REGISTRATION,
    });

    const mine = scope === 'MINE';
    const competitions = need(this.#deps.competitions(), 'competitions').records.list(
      { actor },
      CompetitionQuery.parse({
        status: ACTIVE_COMPETITION_STATUSES.join(','),
        ...(mine ? { mentorId: 'me' } : {}),
      }),
    );
    const active: KpiTile = {
      key: 'ACTIVE_COMPETITIONS',
      label: KPI_LABELS.ACTIVE_COMPETITIONS,
      value: competitions.total,
      totalIsApproximate: false,
      link: {
        to: '/competitions',
        search: { view: 'list', status: [...ACTIVE_COMPETITION_STATUSES], mine },
      },
    };

    const radar = { scope, itemKind: 'TASK', bucket: 'OVERDUE' } as const;
    const overdue = need(this.#deps.deadlines(), 'deadlines').service.list(
      actor,
      DeadlineQuery.parse({ ...radar, limit: 1 }),
    );
    const tasks: KpiTile = {
      key: 'OVERDUE_TASKS',
      label: KPI_LABELS.OVERDUE_TASKS,
      value: overdue.total,
      totalIsApproximate: false,
      link: { to: '/deadlines', search: { ...radar } },
    };
    return { tiles: [upcoming, closing, active, tasks] };
  }
}
