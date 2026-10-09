import { createHash } from 'node:crypto';

/**
 * Saved-search matching (ruling R112, WP-24). Pure: ids in, ids and text out.
 *
 * "New" means an event id the search has **never** matched — `previousIds` is
 * the whole remembered set, not the last run's result — so an event that
 * leaves the results and comes back is not news. One run produces at most one
 * notification per search, naming every new event in one sentence.
 */

/** Ids in `currentIds` that `previousIds` has never held, in `currentIds`' order, once each. */
export function diffMatches(
  previousIds: ReadonlySet<string> | readonly string[],
  currentIds: readonly string[],
): string[] {
  const seen = previousIds instanceof Set ? previousIds : new Set(previousIds);
  const out: string[] = [];
  const added = new Set<string>();
  for (const id of currentIds) {
    if (seen.has(id) || added.has(id)) continue;
    added.add(id);
    out.push(id);
  }
  return out;
}

/**
 * SHA-256 (hex) of the sorted, de-duplicated ids, one per line. Order-free, so
 * the same result set always hashes the same and an unchanged run stops early.
 */
export function resultHash(ids: readonly string[]): string {
  const sorted = [...new Set(ids)].sort();
  return createHash('sha256').update(sorted.join('\n'), 'utf8').digest('hex');
}

/** How many titles the body lists before "and N more". */
export const NEW_MATCH_TITLES_SHOWN = 3;

export interface SavedSearchRef {
  readonly id: string;
  readonly name: string;
}

export interface NewMatchEvent {
  readonly id: string;
  readonly title: string;
}

export interface NewMatchNotification {
  readonly title: string;
  readonly body: string;
  /** Discover with the search applied (an in-app path; notification routes carry no query string). */
  readonly route: string;
  readonly dedupeKey: string;
  readonly subject: { readonly kind: 'saved_search'; readonly id: string };
}

/** The in-app path that opens Discover with a saved search applied. */
export function savedSearchRoute(id: string): string {
  return `/discover/saved/${id}`;
}

/**
 * The one NEW_MATCH for a run: "3 new events match “AI hackathons near
 * campus”", the first three titles and "and N more", keyed
 * `NEW_MATCH:saved_search:<id>:<hash of the new ids>` (R112).
 */
export function newMatchNotification(
  search: SavedSearchRef,
  newEvents: readonly NewMatchEvent[],
): NewMatchNotification {
  if (newEvents.length === 0) throw new Error('newMatchNotification needs at least one event');
  const count = newEvents.length;
  const noun = count === 1 ? 'new event matches' : 'new events match';
  const shown = newEvents.slice(0, NEW_MATCH_TITLES_SHOWN).map((event) => event.title);
  const rest = count - shown.length;
  const body = rest > 0 ? `${shown.join(' · ')} and ${String(rest)} more` : shown.join(' · ');
  return {
    title: `${String(count)} ${noun} “${search.name}”`,
    body,
    route: savedSearchRoute(search.id),
    dedupeKey: `NEW_MATCH:saved_search:${search.id}:${resultHash(newEvents.map((event) => event.id))}`,
    subject: { kind: 'saved_search', id: search.id },
  };
}
