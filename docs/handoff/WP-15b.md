# WP-15b — Category rules engine, facets, deterministic ranking and relevance reasons

**Status: PARTIAL** · 22 Sep 2026 · `pnpm verify` green, **2974 tests** (2873 at WP-15a) ·
`pnpm audit:deps` clean · no new external dependencies. Everything is built and tested. **One perf
scenario misses its build-machine proxy**: filters + text p95 is **52.4 ms** against 50 ms (§6).

## 1. Acceptance

| Criterion | Evidence |
|---|---|
| **Every ranked result carries at least one reason** | `modules/search/ranking.test.ts` › *"holds for every sort, with and without text, over generated queries — every page"*: a fast-check property, 150 generated `SearchRequest`s × up to 4 pages each, every sort, with and without text; each response is parsed with `SearchResponse`. The schema side is `packages/contracts/src/ranking.test.ts` › *"reasons: [] fails the schema"* |
| Reasons are correct | `domain/rank.test.ts`: CLOSING_SOON "Registration closes in 3 days (25 Sep)"; WITHIN_RADIUS "~400 km (straight line)" under a 500 km filter (also end to end in `ranking.test.ts`); `has_conflicts` → no NO_CONFLICTS; a sort key for every sort |
| Determinism | same query twice → identical; RELEVANCE pages = one-shot order, each row once; ties break by deadline then id; raising `noConflicts` / zeroing `closingSoon` reorders in the documented direction |
| Rules engine | goldens over 28 real titles for each kind + the whole seed (`test/fixtures/categories/*.golden.json`, read before commit); "AI" ≠ "Chair"/"AIIMS"/"Maid"; `(a+)+$` refused at write time; a source tag and a rule on one category → one row; order-independence property (100 permutations) |
| Manual wins | `categories/service.test.ts`: a suppression survives a rule edit + full re-classification (and stays out of search); MANUAL never downgraded to RULE |
| Facets | `search/facets.test.ts`: every value of every family equals the `total` of the query with that value applied (9 fixed + 25 generated queries); hidden/merged/user-hidden never counted; no match → all families, all zero |
| Permissions / audit | `routes/categories.test.ts`: 403 for a professor on all 9 `/admin/categor*` routes; one audit row per successful write, none for a refused one |
| Files < 400 lines, no SQL/drizzle under `domain/` | ESLint (the WP-15a rule) clean; largest new file `categories/repo.ts` 394 |

### Rule preview on a real rule (run 22 Sep 2026, seed + real titles, one ADMIN_HIDDEN)

```
rule    {"kind":"REGEX","pattern":"\\brobo(tics|wars?|con)\\b","fields":"TITLE"}
preview {"items":[{"title":"IIT Bombay Techfest Robowars","matchedIn":"TITLE"},
                  {"title":"Robocon India 2026","matchedIn":"TITLE"},
                  {"title":"Flipkart GRiD 7.0 – Robotics Challenge","matchedIn":"TITLE"}],"scanned":6}
rows after preview (event_categories, audit_log, runs) {"ec":0,"a":0,"r":0}
```

### `pnpm perf:search` (outside verify)

```
machine : AMD Ryzen 7 5700 · 16 threads · 15.9 GB · node v24.19.0 · SQLite 3.53.4
corpus  : 20000 events (18998 visible) · classified by the starter seed:
classify: 20000 events → 16564 category rows in ~1990 ms (chunks of 250, one transaction each)
actor   : two interest tags (AI/ML, Cybersecurity/CTF), so the interest lookups run

scenario             p50 ms   p95 ms   p99 ms   budget   result
filters only          14.33    17.54    18.79   <  50    PASS
filters + text        23.48    52.43    57.44   <  50    FAIL
text + distance        5.16    27.84    30.12   <  50    PASS
facets (added)        28.43    53.47    54.63   <  75    PASS
first page+facets     64.90   117.08   122.72       —    INFO
unfiltered feed       62.09    65.37    66.29       —    INFO
detail by id           0.54     0.65     0.97   <  25    PASS
```

"facets (added)" is what asking for facets adds to the same request (measured as a pair each
iteration); §8.3 budgets facets as their own operation. The two INFO rows are new and have no
budget; see Q1.

## 2. What shipped

| Area | Files |
|---|---|
| Contracts | `search.ts`: `RelevanceReason` (closed codes), `RankedEventListItem` (`reasons.min(1)`), `FacetValue`, `Facets`, `SearchRequest` (= `EventQuery` + `facets`); `categories.ts`: `Category`, `CategoryRule`, `CategoryAssignment`, create/patch/preview DTOs; `errors.ts`: `SEARCH_INVALID_RULE`, `SEARCH_RULE_PATTERN_UNSAFE`, new `CATEGORY` domain with `CATEGORY_IN_USE` |
| Migration **0015** (generated, journal re-stamped) | `categories`, `category_rules` (+ partial index on active), `event_categories` (+ index on `category_id`; CHECK: suppressed ⇒ MANUAL), `tags`, `event_tags`, `user_interest_tags`, `category_reclassify_runs` |
| Seed | `resources/category-rules.seed.json`: the 12 starter categories, 87 rules; applied once per `version` (`app_meta.category_seed_version`), never over an admin's edits |
| Rules engine (pure) | `modules/categories/domain/{classify,regex-guard,text}.ts` |
| Categories module | `repo.ts`, `service.ts` (classifier + batched re-classification), `admin.ts` (CRUD, preview), `seed.ts`, `errors.ts`, `wiring.ts` (+ job `categories:reclassify`) |
| Ingest hook | `EventResolver` gains `onResolved`, so scrape, auto-merge, manual entry, URL import, merge and unmerge all classify, in the same transaction |
| Ranking | `modules/search/domain/rank.ts` (pure; the definition), `score-sql.ts` (its SQL mirror for ordering), `settings.ts` (`search.ranking.weights`, `search.ranking.thresholds`, defaults in one table) |
| Facets | `modules/search/domain/facets.ts` (assembly + the counting rule), `facets.ts` (one statement) |
| Search refactor | `sql.ts` (filters split by facet family), `rows.ts`, `mapping.ts`; `repo.ts` now 3 statements (keyset, RELEVANCE, detail helpers) |
| Routes | `GET/POST/PATCH/DELETE /admin/categories[/:id][?reassign=]`, `GET/POST/PATCH/DELETE /admin/category-rules[/:id]`, `POST /admin/category-rules/preview`; `POST /search/events` returns ranked items + facets |
| Perf | `tools/perf/search/src/scenarios.ts` (split out of `run.ts`), classification + interests in the corpus |

## 3. Deviations from the prompt

1. **One reason code beyond the ten: `SORT_KEY`.** START and PRIZE sorts have no code in the list,
   and an event that fires no boost must still say something. `SORT_KEY` states the sort's value
   ("Starts 3 Oct", "Prize ₹50,000") and, for RELEVANCE with nothing firing, the deadline its
   tie-break used. Without it no code path could guarantee a non-empty list.
2. **`tags`, `event_tags`, `user_interest_tags` created.** The prompt lists only the category tables,
   but ranking reads `user_interest_tags` (FK → `tags`), and R48 gives `event_tags` to WP-15b. They
   follow §6.2 exactly. Nothing writes `event_tags` yet (WP-15a Q1 is still open).
3. **RELEVANCE is ordered in SQL, not only in `rank.ts`.** `rank.ts` is the pure definition and
   explains every page row. `score-sql.ts` mirrors it in integer milli-points so the database can order
   and page 19k rows. Scoring in JS cost ~35 ms just to read them. The property test asserts the
   SQL order is the order `rank.ts`'s scores imply, on every page of 150 generated queries.
4. **`categories` and `tags` filters are live** (WP-15a answered 400). The category facet's
   "count = results" rule needs the filter to exist.
5. **`platform/time.ts`: valid zones are memoized.** `formatDay` validated its zone by building a new
   `Intl.DateTimeFormat` on every call. Reasons call it ~10× per card, and the memo alone took
   "filters only" from 27 to 17 ms.

## 4. Minor decisions

1. **Classification**: confidence = Σ weights / 100, capped at 1; total weight 0 → not assigned.
   A SOURCE_TAG hit makes the row `SOURCE_TAG` (the source said so), `rule_id` = heaviest contributor.
   No implicit tag→category match: a tag counts only through a SOURCE_TAG rule.
2. KEYWORD must normalize to exactly one word (else `SEARCH_INVALID_RULE`); punctuation splits words,
   so "A.I." is `a i`. REGEX compiles `iu`; a pattern that matches empty text is refused.
3. **Regex guard**: nested unbounded quantifiers refused (`(a+)+`, `(x+){2,9}`). Overlapping
   alternations (`(a|a)*`) are *not* detected; the 20 000-character input budget bounds the damage.
4. **Suppression is a MANUAL row** (`is_suppressed = 1` ⇒ `origin = 'MANUAL'`, a CHECK). AI rows are
   left alone like MANUAL ones. `repo.setManual` exists for WP-16b; there is no override route here.
5. **Re-classification** covers every non-merged event (a rule edit can add matches anywhere), 250 per
   transaction, position committed per chunk, a newer request supersedes a running one. It runs as
   the GENERAL job `categories:reclassify` (triggered on every rule write, 10-min fallback tick).
6. Category delete: `?reassign=` moves assignments **and rules**, keeping the MANUAL row on a clash.
   Without reassign, a category with any assignment (hidden events too) → `CATEGORY_IN_USE`.
   A duplicate name/slug → common `CONFLICT`. Deactivating a category re-classifies.
7. **Ranking defaults** (`search/settings.ts`): text ≤ 40 (bm25 / best bm25 in the set; substring-only
   = 0), closing soon 15, registration open 10, category interest 20, tag interest 15, within radius
   10, team size fits 5, trusted source 5, sources agree 5, recently added 5. Thresholds: closing soon
   7 days (also feeds the planner's CLOSING_SOON state, so filter, facet and boost agree), recently
   added 7 days, trusted = `trust_rank ≥ 40` (every seeded source except CLIST's 20).
8. WITHIN_RADIUS uses `maxDistanceKm`, or `geography.nearbyRadiusKm` when the query has none.
   TEAM_SIZE_FITS fires only when `teamSizeFits` is asked. A category matches an interest tag when
   their folded names (or the tag's aliases, or the slug) agree: "AI/ML" = "ai-ml".
9. Month names are a fixed table: ICU's en-GB now says "Sept", §8.4 says "27 Sep".
10. **Facet counting rule**: a value's count = results with that family's filter set to exactly that
    value, everything else unchanged. Visibility, `excludeHidden` and `watchlistedOnly` apply first.
    So distance buckets are cumulative, ONLINE/unknown-location rows join buckets as A6 admits them,
    and unknown deadlines join every state count when `includeUnknown.deadline` is set. Enum families
    list every value (zeros too). Categories: all active ones, top 20 by count, then `OTHER` (distinct
    events; a second statement, only past 20 categories). Without a campus only `ANYWHERE` is offered.
11. `SearchRequest.facets` defaults to true. Facets are computed on later pages too unless the caller
    sends `facets: false`.

## 5. Known issues / tech debt

- **The perf miss (§1, Q1).** Per-row lookups for TRUSTED_SOURCE and the two interest boosts cost
  ~12 ms each over 19k rows, whether written as `IN`, `EXISTS` or with a covering index (measured).
- The first-page RELEVANCE query for a *specific* professor depends on their interests: each extra
  interest lookup is a per-row cost.
- `categories/repo.ts` is 394 lines.
- The FTS `tags` column is still empty (WP-15a Q1).

## 6. Questions for the architect

1. **Perf budget on the unfiltered feed.** "filters + text" p95 is 52.4 ms against the halved 50 ms
   (WP-15a: 34.7 ms without ranking). The unfiltered Discover feed, which no WP-15a scenario covered,
   is 65 ms, and a first page with facets is 117 ms here. That is likely over §8.3's 100 ms on the
   8 GB target. The cost is three per-row lookups (trusted source, category interest, tag interest)
   over every matching event. Options: (a) denormalize them onto `events` (`top_trust_rank`, updated
   by the resolver; interests stay per user, so only trust helps); (b) cap RELEVANCE's candidate set
   (e.g. score the top 2 000 by deadline); (c) accept and re-measure on the 8 GB machine in WP-31.
   Recommendation: **(a) for trust + (c)**, and decide whether the unfiltered feed becomes a budgeted
   scenario.
2. `SORT_KEY` as an eleventh reason code (deviation 1): acceptable, or should the UI get its sort
   reason another way?
3. Should creating `tags`/`event_tags`/`user_interest_tags` here stand (deviation 2), and who writes
   `event_tags` (WP-15a Q1)?

## 7. Files the architect should review

1. `apps/backend/src/modules/search/domain/rank.ts`
2. `apps/backend/src/modules/search/score-sql.ts`
3. `apps/backend/src/modules/categories/domain/classify.ts`
4. `apps/backend/src/modules/search/facets.ts` (+ `domain/facets.ts` for the counting rule)
5. `apps/backend/migrations/0015_categories_and_tags.sql`

## 8. Suggested next step

Rule on Q1 (a one-column follow-up if (a)), then WP-16a. WP-16b's override control can call
`CategoriesRepository.setManual`; the category chips read `EventCore.categories`, which is now filled.
