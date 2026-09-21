# WP-15a — `EventQuery`, query builder, FTS5 + trigram, aliases, typo vocabulary, perf test

**Status: DONE** · 22 Sep 2026 · `pnpm verify` green · `pnpm perf:search` green · `pnpm audit:deps`
clean. No new external dependencies (one new workspace package, `@compintel/perf-search`).

## 1. Acceptance

| Criterion | Evidence |
|---|---|
| `EventQuery` strict, one query model | `packages/contracts/src/search.ts`; `search.test.ts` — every field, strict-object, ranges, bounds |
| A7 dates | `modules/search/domain/normalize.test.ts` (IST day bounds, year boundary, 18:31 UTC = next IST day) + `filters.test.ts` on a DB |
| A6 unknowns / distance | `filters.test.ts` — one block per field (fee, team size, location, deadline); `freeOnly` never matches unknown; ONLINE only when `modes` names it |
| Triggers (F6) | `db/search-migration.test.ts` — insert, title update, delete (no orphans, FTS `integrity-check`), raw-SQL insert |
| Injection | `search.test.ts` — `"`, `*`, `NEAR(`, `OR`, unbalanced quote, 200 chars: literal, never an error |
| Typo AC | `typo.test.ts` — "hackthon" → hackathon, "cyber secuirty" → cybersecurity, both with the message; a hit word is never corrected; no correction under 4 letters |
| Trigram | `trigram.test.ts` — "ackath" finds "Hackathon"; a 2-char fragment finds nothing |
| Aliases | `search.test.ts` — ML ↔ machine learning both ways; deleting the alias reverses it |
| Visibility | `filters.test.ts` — POLICY_HIDDEN / ADMIN_HIDDEN / MERGED absent with and without text, `total` too |
| Cursor | `search.test.ts` — every row exactly once for 5 sorts × with/without text; tampered/truncated/foreign cursor → `SEARCH_INVALID_CURSOR` (also over HTTP in `routes/search.test.ts`) |
| Migrations | empty DB and a DB migrated to 0012 holding events → both indexes, view, triggers, backfill |
| `drizzle-kit push` absent | the existing `scripts.test.ts` still passes |
| No SQL outside `repo.ts`/migrations, no drizzle under `domain/` | ESLint now also bans I/O imports under `apps/backend/src/modules/*/domain/**` |

### Typo AC, as the API answers it

```
text "hackthon"       → correction { searchedTerm: "hackthon", usedTerm: "hackathon",
                        message: "Showing results for hackathon (searched hackthon)" }
text "cyber secuirty" → correction { searchedTerm: "cyber secuirty", usedTerm: "cybersecurity",
                        message: "Showing results for cybersecurity (searched cyber secuirty)" }
```

### `pnpm perf:search` (outside verify)

```
machine : AMD Ryzen 7 5700 · 16 threads · 15.9 GB · node v24.19.0 · SQLite 3.53.4
corpus  : 20000 events (18998 visible), sha256 4c770d4af83705f1…
seeding : ~4 s incl. FTS triggers · vocabulary refresh 55 ms
budgets : §8.3 halved — query p95 < 50 ms, detail p95 < 25 ms

scenario           p50 ms   p95 ms   p99 ms   budget   result
filters only        15.63    21.72    23.19   <  50    PASS
filters + text       4.86    34.65    42.87   <  50    PASS
text + distance      4.83    31.02    36.29   <  50    PASS
detail by id         0.53     0.91     0.99   <  25    PASS
facets                  —        —        —   <  75    SKIPPED (WP-15b)
```

The p95 of the text scenarios is one query: "security challenge" matches ~7 500 events because the
synthetic descriptions draw from a 40-word vocabulary. Real descriptions are far more varied, so this
is a pessimistic number. A `CROSS JOIN` that makes SQLite walk the text hits instead of all events
took the text median from ~15 ms to ~5 ms.

## 2. What shipped

| Area | Files |
|---|---|
| Contracts | `search.ts` (EventQuery, IsoDate, Money, EventListItem, SearchResponse, SpellingCorrection, alias DTOs, EventCore); `errors.ts`: `SEARCH_QUERY_INVALID` renamed `SEARCH_INVALID_QUERY` (nothing raised it), plus `SEARCH_INVALID_CURSOR`, `SEARCH_TEXT_TOO_LONG`, `SEARCH_ALIAS_EXISTS` |
| Migration **0013** (generated) | `search_vocabulary`, `search_aliases`, `event_user_state`, `watchlist_items` |
| Migration **0014** (custom) | view `event_search_source`, `event_fts` (porter unicode61 remove_diacritics 2), `event_fts_trigram` (trigram remove_diacritics 1), 3 triggers, backfill `rebuild`, alias seed |
| Pure domain | `modules/search/domain/{normalize,text,trigram,typo,distance}.ts` |
| Module | `repo.ts` (all raw SQL), `service.ts`, `cursor.ts`, `aliases.ts`, `vocabulary.ts`, `errors.ts`, `wiring.ts` |
| Routes | `POST /search/events`, `GET /events/:id`, `GET /admin/search-aliases`, `PUT/DELETE /admin/search-aliases/:term` |
| Wiring | `main.ts` (module, vocabulary refresh at start and after every scrape run with new/updated items and every import), `app.ts`, `SourcesService.onIngested`, `EventImportService.onIngested` |
| Perf | `tools/perf/search/` (in-house mulberry32 PRNG, pure corpus, runner), root script `perf:search` |

## 3. Deviations from the prompt

1. **The FTS content table is a view, not `events`.** FTS5 reads content columns *by name* on
   `rebuild`, and `events` has no `tags` column. `event_search_source` renames the columns and supplies
   `tags = ''`. `content_rowid` is `events.rowid`, which survives `VACUUM INTO` (tested).
2. **`event_user_state` and `watchlist_items` land here, not in WP-16a (R48).** The query builder joins
   both. They follow §6.2 exactly; WP-16a only adds the routes that write them.
3. **`categories` / `tags` filters answer 400 `SEARCH_INVALID_QUERY`** ("not available yet"). Neither is
   stored. Returning unfiltered results would be the wrong answer.
4. **`SearchResponse` also carries `total`** (exact; a window count taken in the same statement), so
   `totalIsApproximate` is `false` for now.
5. **Journal timestamps.** drizzle-kit stamped 0013/0014 earlier than 0012's hand-set `when`, and the
   migrator only applies entries newer than the last one applied, so an upgraded DB would silently skip
   them. They are re-stamped, and a new test asserts `when` strictly increases.

## 4. Minor decisions

1. RELEVANCE without text orders by deadline; with text, by bm25. Trigram-only hits score 0 and rank
   after every word hit. WP-15b replaces this.
2. Distance is measured only to EXACT/INSTITUTION/CITY coordinates. STATE/COUNTRY centroids count as an
   unknown location, both in the filter and in `distanceKm`. A mode of UNKNOWN is "not online".
3. Team size: a missing bound is open-ended; both missing is unknown.
4. `feeMax` compares only in the same currency, except that a fee of 0 is free in any currency.
   `prizeMin` matches the same currency only. PRIZE sorts by amount across currencies.
5. `eventDate` means overlap: [start, end ?? start] touches the range. An unknown start never matches.
   Ended = `coalesce(ends_at, starts_at) < now`.
6. Registration states are disjoint as the enum says (OPEN excludes CLOSING_SOON). NOT_OPEN takes
   precedence.
7. Typo: OSA distance (a transposition is 1 edit). A word counts as a hit if either index finds a
   *visible* event. A zero-hit word is also tried joined to its neighbour; on a tie the joined form wins
   (that is how "cyber secuirty" reaches "cybersecurity"). Only purely alphabetic words are corrected.
   The message is plain text: "Showing results for X (searched Y)".
8. Trigram uses whitespace fragments verbatim. If *any* fragment is under 3 characters there is no
   substring branch, because dropping only the short one would loosen the AND.
9. Text with no word and no ≥3-char fragment (`"*"`) matches nothing. It is not an error and not "no
   filter".
10. Aliases are equivalence groups (union-find over term + expansions). An alias change drops the cache
    and refreshes the vocabulary. The permission is `category.manage` (§10.2 "categories & rules"), and
    it applies to GET as well. `PUT` refuses an existing term unless `replace: true`.
11. Cursors are HMAC-signed with a per-process key and carry a query fingerprint and the sort basis. A
    backend restart invalidates them (the UI starts over).
12. Detail: a hidden, merged or missing event returns 404 `EVENT_NOT_FOUND`; `categories: []` until
    WP-15b.
13. A distance filter or DISTANCE sort with no primary campus answers `SEARCH_INVALID_QUERY`.
14. `testing/events.ts#tableCounts` skips FTS virtual/shadow tables. Their row counts are index
    segments, and R66's "nothing deleted" check was tripping on a reindex.

## 5. Known issues / tech debt

- **RELEVANCE pagination is not insert-stable.** bm25 depends on corpus statistics, so an insert
  mid-scroll can move a row across a page boundary. Structured sorts are stable (tested). Revisit with
  WP-15b's score.
- The FTS `tags` column is always empty (see Q1).
- The vocabulary is rebuilt wholesale on every ingest: ~55 ms at 20 000 events.
- `routes/routes.test.ts` "body limit" timed out once under full-suite load and passes alone; it was
  already there before this WP.

## 6. Questions for the architect

1. **Where do event tags come from?** §6.2 has `tags`/`event_tags`; R48 gives `event_tags` to WP-15b,
   whose prompt does not mention it. Until then the FTS `tags` column and the `tags` filter are inert.
2. Is moving `event_user_state`/`watchlist_items` from WP-16a to WP-15a acceptable (§3.2)?
3. Should STATE/COUNTRY-precision events count as "unknown location" for distance (§4.2)?

## 7. Files the architect should review

1. `apps/backend/migrations/0014_search_fts.sql`
2. `apps/backend/src/modules/search/domain/normalize.ts`
3. `apps/backend/src/modules/search/repo.ts`
4. `apps/backend/src/modules/search/domain/typo.ts`
5. `packages/contracts/src/search.ts`

## 8. Suggested next step

WP-15b. Its ranking replaces minor decision 1, its categories switch on the `categories` filter and
fill `EventCore.categories` and the vocabulary's CATEGORY terms, and its facet scenario slots into
`tools/perf/search/src/run.ts`.
