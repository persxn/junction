import {
  EventQuery,
  problemType,
  type MyInterestsView,
  type SavedSearch,
} from '@compintel/contracts';

import { NOW } from './clock.js';

const AT = new Date(NOW).toISOString();

/**
 * An in-memory `/saved-searches` and `/me/interests` (WP-24), chained into the
 * fake search's fetch stub before its 404. Shaped like the real routes:
 * versions bump, a stale version or a taken name is a 409 problem, the stored
 * query comes back as an `EventQuery`.
 */

export interface FakeSavedSearches {
  readonly searches: SavedSearch[];
  readonly interests: MyInterestsView;
  /** Answers a request, or undefined when the path is not one of these routes. */
  handle(method: string, path: string, body: Record<string, unknown> | undefined): unknown;
}

export const CATEGORY_OPTIONS = [
  { id: '01931f2a-0000-7000-8000-00000000c001', name: 'AI/ML' },
  { id: '01931f2a-0000-7000-8000-00000000c002', name: 'Cybersecurity/CTF' },
];

/** What `/me/interests/tag-options` offers, whatever is typed. */
export const TAG_OPTIONS = [{ id: '01931f2a-0000-7000-8000-00000000a001', name: 'Rust' }];

export class FakeProblem {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

const problem = (status: number, code: 'SAVED_SEARCH_NAME_TAKEN' | 'NOT_FOUND', title: string) =>
  new FakeProblem(status, {
    type: problemType(code),
    title,
    status,
    code,
    detail: title,
    requestId: '0199a0d4-7c3a-7b21-9a4e-00000000ss01',
  });

export function fakeSavedSearches(): FakeSavedSearches {
  const searches: SavedSearch[] = [];
  const interests: MyInterestsView = {
    categoryIds: [],
    tagIds: [],
    categoryOptions: CATEGORY_OPTIONS,
    tags: [],
  };
  let next = 1;
  const id = (): string => `01931f2a-0000-7000-8000-${String(next++).padStart(12, '0')}`;

  const handle = (
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
  ): unknown => {
    if (path === '/api/v1/saved-searches' && method === 'GET') return { items: searches };
    if (path === '/api/v1/saved-searches' && method === 'POST') {
      const name = typeof body?.name === 'string' ? body.name : '';
      if (searches.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        return problem(
          409,
          'SAVED_SEARCH_NAME_TAKEN',
          `“${name}” is already one of your saved searches.`,
        );
      }
      const created: SavedSearch = {
        id: id(),
        name,
        query: EventQuery.parse(body?.query ?? {}),
        invalidQuery: false,
        notifyOnNew: body?.notifyOnNew !== false,
        lastEvaluatedAt: AT,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
      };
      searches.push(created);
      return created;
    }
    const one = /^\/api\/v1\/saved-searches\/([^/]+)$/.exec(path);
    if (one !== null) {
      const index = searches.findIndex((s) => s.id === one[1]);
      const found = searches[index];
      if (found === undefined) return problem(404, 'NOT_FOUND', 'No such saved search');
      if (method === 'DELETE') {
        searches.splice(index, 1);
        return undefined;
      }
      const updated: SavedSearch = {
        ...found,
        ...(typeof body?.name === 'string' ? { name: body.name } : {}),
        ...(body?.notifyOnNew === undefined ? {} : { notifyOnNew: body.notifyOnNew === true }),
        ...(body?.query === undefined ? {} : { query: EventQuery.parse(body.query) }),
        version: found.version + 1,
      };
      searches[index] = updated;
      return updated;
    }
    if (path === '/api/v1/me/interests' && method === 'GET') return interests;
    if (path === '/api/v1/me/interests' && method === 'PUT') {
      interests.categoryIds = (body?.categoryIds ?? []) as string[];
      const typed = ((body?.newTagNames ?? []) as string[]).map((name) => ({ id: id(), name }));
      const known = [...interests.tags, ...TAG_OPTIONS];
      const kept = ((body?.tagIds ?? []) as string[]).flatMap((tagId) =>
        known.filter((tag) => tag.id === tagId).slice(0, 1),
      );
      interests.tags = [...kept, ...typed];
      interests.tagIds = interests.tags.map((tag) => tag.id);
      return interests;
    }
    const category = /^\/api\/v1\/me\/interests\/categories\/([^/]+)$/.exec(path);
    if (category !== null) {
      const categoryId = category[1] ?? '';
      interests.categoryIds =
        method === 'POST'
          ? [...new Set([...interests.categoryIds, categoryId])]
          : interests.categoryIds.filter((value) => value !== categoryId);
      return interests;
    }
    if (path === '/api/v1/me/interests/tag-options') {
      return { tags: TAG_OPTIONS };
    }
    return NOT_MINE;
  };
  return { searches, interests, handle };
}

/** `handle` found no route of its own. */
export const NOT_MINE = Symbol('not a saved-search route');
