import {
  URGENCY_BUCKETS,
  type BucketCounts,
  type DeadlineListResponse,
  type DeadlineQuery,
  type DueItem,
} from '@compintel/contracts';

import { dueItems } from '../../domain/deadlines/buckets.js';
import { AppError } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import type { DeadlineFilter, DeadlinesRepository } from './repo.js';

/**
 * The Deadline Radar's answers (WP-22, R106–R107): one person's items under a
 * filter, bucketed at request time. The counts and the list are computed from
 * the same set by the same code, so a bucket's count is always the length of
 * that bucket's fully paged list (the §19 AC).
 */

const encodeCursor = (item: DueItem): string =>
  Buffer.from(`${item.dueAt}|${item.id}`, 'utf8').toString('base64url');

function decodeCursor(cursor: string): { dueAt: string; id: string } {
  const [dueAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (dueAt === undefined || id === undefined) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      status: 400,
      title: 'That page link is not valid',
      detail: 'Start again from the first page.',
      retryable: false,
    });
  }
  return { dueAt, id };
}

export class DeadlinesService {
  readonly #repo: DeadlinesRepository;
  readonly #clock: Clock;

  constructor(deps: { repo: DeadlinesRepository; clock?: Clock }) {
    this.#repo = deps.repo;
    this.#clock = deps.clock ?? systemClock;
  }

  /** Every item the person may see under the filter, bucketed now. */
  items(actor: Principal, filter: DeadlineFilter): DueItem[] {
    assertCan(actor, 'competition.view');
    if (filter.scope === 'TEAM' && filter.teamId === undefined) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        status: 400,
        title: 'Pick a team',
        detail: 'The team scope needs a team.',
        retryable: false,
      });
    }
    return dueItems(this.#repo.rows(filter, actor.id), nowMs(this.#clock));
  }

  countsByBucket(items: readonly DueItem[]): BucketCounts {
    const counts = Object.fromEntries(URGENCY_BUCKETS.map((bucket) => [bucket, 0])) as BucketCounts;
    for (const item of items) counts[item.bucket] += 1;
    return counts;
  }

  list(actor: Principal, query: DeadlineQuery): DeadlineListResponse {
    const all = this.items(actor, {
      scope: query.scope,
      teamId: query.teamId,
      group: query.group,
      itemKind: query.itemKind,
    });
    const chosen =
      query.bucket === undefined ? all : all.filter((item) => item.bucket === query.bucket);
    let start = 0;
    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);
      start = chosen.findIndex(
        (item) => item.dueAt > after.dueAt || (item.dueAt === after.dueAt && item.id > after.id),
      );
      if (start < 0) start = chosen.length;
    }
    const page = chosen.slice(start, start + query.limit);
    const last = page.at(-1);
    return {
      items: page,
      counts: this.countsByBucket(all),
      total: chosen.length,
      nextCursor:
        start + query.limit < chosen.length && last !== undefined ? encodeCursor(last) : null,
    };
  }

  /** For the evaluator: every live item, all scopes at once, at the job's own `now`. */
  everything(now: number = nowMs(this.#clock)): DueItem[] {
    return dueItems(this.#repo.allRows(), now);
  }
}
