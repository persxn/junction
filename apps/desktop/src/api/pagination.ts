/**
 * Cursor pagination (ARCHITECTURE.md §4.4).
 *
 * Every list endpoint answers in this shape. It is opaque on purpose: the cursor
 * encodes the sort key of the last row, so a page never shifts under the reader
 * when rows are inserted, and the UI must never take it apart.
 *
 * These types live here rather than in `packages/contracts` only because WP-06 is
 * scoped to `apps/desktop`; they belong beside the other API DTOs as soon as the
 * first paginated endpoint exists (see the report's questions).
 */

/** What the caller asks for. */
export interface CursorQuery {
  /** Opaque cursor from the previous page; omitted for the first page. */
  readonly cursor?: string | undefined;
  /** How many rows to return. The backend clamps it; the UI does not guess. */
  readonly limit?: number | undefined;
}

/** What a list endpoint returns. */
export interface CursorPage<T> {
  readonly items: readonly T[];
  /** Cursor for the next page, or `null` when this was the last one. */
  readonly nextCursor: string | null;
}

/** Query-string fragment for a cursor request, without a leading `?`. */
export function cursorSearchParams(query: CursorQuery = {}): string {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) {
    params.set('cursor', query.cursor);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  return params.toString();
}

/** Appends a cursor query to a path, leaving the path untouched when it is empty. */
export function withCursor(path: string, query: CursorQuery = {}): string {
  const search = cursorSearchParams(query);
  return search === '' ? path : `${path}?${search}`;
}

/** What TanStack Query's `getNextPageParam` needs from a page. */
export function nextCursorOf<T>(page: CursorPage<T>): string | undefined {
  return page.nextCursor ?? undefined;
}
