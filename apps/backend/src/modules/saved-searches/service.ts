import {
  EventQuery,
  type SavedSearch,
  type SavedSearchCreate,
  type SavedSearchList,
  type SavedSearchPatch,
} from '@compintel/contracts';

import { resultHash } from '../../domain/saved-searches/matches.js';
import { uuid7, type Uuid7Generator } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { savedSearchNameTaken, savedSearchNotFound, savedSearchVersionConflict } from './errors.js';
import type { SavedSearchesRepository, SavedSearchRecord } from './repo.js';

/**
 * A professor's saved searches (§6.2, R112, WP-24). Owner only: another
 * person's id answers 404. Personal and not audited, like Save and Hide.
 *
 * Creating a search, or changing its query, records what it matches **now**
 * as its baseline, silently — nobody is told "57 new matches" for a search
 * they just made. Only the evaluator (`evaluator.ts`) ever announces matches.
 */

/** What baselining needs from search: the ids-only path (`SearchService.matchingIds`). */
export type MatchingIds = (userId: string, query: EventQuery) => string[];

export interface SavedSearchServiceDependencies {
  readonly repo: SavedSearchesRepository;
  readonly matchingIds: MatchingIds;
  readonly clock?: Clock;
  readonly ids?: Uuid7Generator;
}

/** What is stored: the query without its cursor or page size, which are not part of "what I want". */
export function storedQueryJson(query: EventQuery): string {
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  return JSON.stringify(rest);
}

/** The stored query, or null when it no longer parses (it is then never evaluated). */
export function parseStoredQuery(json: string): EventQuery | null {
  try {
    const parsed = EventQuery.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function toSavedSearch(record: SavedSearchRecord): SavedSearch {
  const query = parseStoredQuery(record.queryJson);
  return {
    id: record.id,
    name: record.name,
    query,
    invalidQuery: query === null,
    notifyOnNew: record.notifyOnNew,
    lastEvaluatedAt: record.lastEvaluatedAt === null ? null : iso(record.lastEvaluatedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    version: record.version,
  };
}

export class SavedSearchService {
  readonly #deps: SavedSearchServiceDependencies;
  readonly #clock: Clock;
  readonly #ids: Uuid7Generator;

  constructor(deps: SavedSearchServiceDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#ids = deps.ids ?? uuid7;
  }

  list(actor: Principal): SavedSearchList {
    assertCan(actor, 'event.view');
    return { items: this.#deps.repo.listOwned(actor.id).map(toSavedSearch) };
  }

  /** `input` has been parsed by the route (`SavedSearchCreate`). */
  create(actor: Principal, input: SavedSearchCreate): SavedSearch {
    assertCan(actor, 'event.view');
    const repo = this.#deps.repo;
    if (repo.nameTaken(actor.id, input.name, null)) throw savedSearchNameTaken(input.name);
    const at = nowMs(this.#clock);
    // Planned before anything is written: a query search refuses is refused here too.
    const matches = this.#deps.matchingIds(actor.id, input.query);
    const id = this.#ids();
    repo.transaction(() => {
      repo.insert({
        id,
        userId: actor.id,
        departmentId: repo.departmentFor(actor.id),
        name: input.name,
        queryJson: storedQueryJson(input.query),
        notifyOnNew: input.notifyOnNew,
        at,
      });
      this.#baseline(id, matches, at);
    });
    return this.#read(actor, id);
  }

  patch(actor: Principal, id: string, input: SavedSearchPatch): SavedSearch {
    assertCan(actor, 'event.view');
    const repo = this.#deps.repo;
    const current = repo.findOwned(actor.id, id);
    if (current === undefined) throw savedSearchNotFound();
    if (current.version !== input.version) throw savedSearchVersionConflict();
    const name = input.name ?? current.name;
    if (input.name !== undefined && repo.nameTaken(actor.id, name, id)) {
      throw savedSearchNameTaken(name);
    }
    const queryJson = input.query === undefined ? current.queryJson : storedQueryJson(input.query);
    const requery = input.query !== undefined && queryJson !== current.queryJson;
    const matches =
      requery && input.query !== undefined ? this.#deps.matchingIds(actor.id, input.query) : [];
    const at = nowMs(this.#clock);
    repo.transaction(() => {
      const written = repo.update(
        id,
        input.version,
        { name, queryJson, notifyOnNew: input.notifyOnNew ?? current.notifyOnNew },
        at,
      );
      if (!written) throw savedSearchVersionConflict();
      if (requery) {
        repo.clearMatches(id);
        this.#baseline(id, matches, at);
      }
    });
    return this.#read(actor, id);
  }

  delete(actor: Principal, id: string, version: number): void {
    assertCan(actor, 'event.view');
    const current = this.#deps.repo.findOwned(actor.id, id);
    if (current === undefined) throw savedSearchNotFound();
    if (!this.#deps.repo.delete(id, version)) throw savedSearchVersionConflict();
  }

  /** R112: record the current matches, tell nobody. */
  #baseline(id: string, matches: readonly string[], at: number): void {
    this.#deps.repo.addMatches(id, matches, at);
    this.#deps.repo.markEvaluated(id, at, resultHash(matches));
  }

  #read(actor: Principal, id: string): SavedSearch {
    const record = this.#deps.repo.findOwned(actor.id, id);
    if (record === undefined) throw savedSearchNotFound();
    return toSavedSearch(record);
  }
}
