WP-15a — `EventQuery` contract, query builder, FTS5 + trigram index, aliases, typo vocabulary, perf test

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-08a.md · docs/handoff/WP-08b.md ·
docs/handoff/WP-10.md · docs/adr/ADR-0005-database-sqlite-drizzle.md · docs/adr/ADR-0006-search-fts5.md ·
docs/adr/ADR-0015-time-utc-iana-precision.md · docs/ARCHITECTURE.md §4.5, §4.6, §4.7, **§8 (all of it)**,
§6.2 ("Taxonomy" and "Events" tables incl. the `events` column groups and indexes), §7.4, §17, §21 ·
docs/DECISIONS.md (D-06, D-08) · packages/contracts/src/*.ts · apps/backend/src/db/** ·
apps/backend/src/platform/** · apps/backend/src/domain/** · apps/backend/src/testing/** ·
apps/backend/src/modules/events/**. Do NOT read apps/desktop — there is no UI in this WP.

BINDING RULINGS (§21 — they beat the section prose where they differ):
- **F5/A5 — typos are NOT trigram.** `event_fts_trigram` gives **substring** matching only (≥ 3 chars).
  Typo tolerance is a **separate** step: a vocabulary table + edit distance. §8.2's own wording has misled
  readers before; build the two mechanisms as two independent modules with two independent test files.
- **F6 — Drizzle cannot model FTS5 virtual tables or triggers.** They go in a **custom SQL migration**
  (`pnpm --filter @compintel/backend db:generate:custom`). `drizzle-kit push` is banned and a test enforces it.
- **A6 — unknown values and distance.** Per-field `includeUnknown`; `maxDistanceKm` applies to OFFLINE and
  HYBRID, and excludes ONLINE unless `modes` explicitly contains ONLINE.
- **A7 — dates.** `YYYY-MM-DD` interpreted in Asia/Kolkata, `from` = 00:00:00.000 of that day, `to` = end of
  that day, both inclusive, converted to UTC ms by the builder. Time comes from `platform/time.ts`'s
  injectable `Clock` — never `new Date()` inline.
- **D-06 / §7.4 — distance is straight-line**; POLICY_HIDDEN, ADMIN_HIDDEN and MERGED events never appear in
  search results, facets or counts, for anyone.
- **R12** — new error codes are `SEARCH_`-prefixed in the one closed enum in `packages/contracts/src/errors.ts`.

BUILD:
1. contracts — `packages/contracts/src/search.ts`: `EventQuery` exactly as §8.1 lists it, a **strict** zod
   object (unknown keys rejected), `limit` default 25 / max 100, `text` max 200 chars, opaque `cursor`,
   `IsoDate` a `YYYY-MM-DD` regex + real-date check, ranges validated (`from ≤ to`, `maxDistanceKm > 0`).
   Plus `EventListItem` (the dense-card fields of §16.2: id, title, organizer, event type, mode,
   distanceKm?, registrationDeadlineAt?, startsAt?, prize, teamMin/Max, sources[], hasConflicts),
   `SearchResponse` {items, nextCursor?, totalIsApproximate, correction?}, and
   `SpellingCorrection` {searchedTerm, usedTerm, message}. Codes `SEARCH_INVALID_QUERY`,
   `SEARCH_INVALID_CURSOR`, `SEARCH_TEXT_TOO_LONG`, `SEARCH_ALIAS_EXISTS`. A test per field and per rule —
   this contract is consumed by the filter UI, saved searches and (M4) the AI planner, so it is the one
   query model and nothing downstream may invent a second shape.
2. Domain (pure, `apps/backend/src/modules/search/domain/` — the ESLint boundary forbids drizzle/fastify/
   node:fs here): `normalize.ts` (query → `QueryPlan`: resolved UTC bounds per A7, per-field unknown
   handling per A6, mode/distance interaction, sort + tie-break), `text.ts` (tokenizer, **escaping user text
   into quoted FTS tokens** so no FTS operator can be injected, alias expansion), `distance.ts` (bounding
   box for a radius). `QueryPlan` is golden-tested with `expectGolden` so a plan change is visible in review.
3. Migration (custom SQL, next free number): `event_fts` — FTS5 **external content** (`content='events'`,
   `content_rowid=...`), columns title, organizer, tags, description, `tokenize='unicode61 remove_diacritics 2'`
   chained with porter per §8.2 — plus `event_fts_trigram` (`tokenize='trigram'`) over title + organizer,
   plus AFTER INSERT / AFTER UPDATE / AFTER DELETE triggers on `events` that keep both indexes in sync
   (delete-then-insert on update), plus `search_vocabulary` (term PK, kind, doc_freq) and `search_aliases`
   (§6.2) with a seed (ML ↔ machine learning, GenAI ↔ generative AI, CTF ↔ capture the flag).
4. Query builder + execution (`repo.ts`, the only place raw SQL lives): structured filters → indexed SQL over
   the §6.2 indexes; distance = bounding-box prefilter on (lat, lon) then the exact haversine SQL function
   from WP-08b; text → `event_fts` with **bm25 weights title 10, organizer 4, tags 3, description 1** unioned
   with trigram substring hits; `excludeHidden` joins `event_user_state`, `watchlistedOnly` joins
   `watchlist_items`; recurring rounds excluded unless `includeRecurring`; ended events excluded unless
   `includeEnded`. Pagination is a **keyset cursor** (sort key + id tie-break), signed/encoded so a tampered
   cursor answers `SEARCH_INVALID_CURSOR`, and stable when rows are inserted mid-scroll.
5. Typo tolerance (F5/A5): `vocabulary.ts` refreshes `search_vocabulary` from distinct title/organizer/tag
   tokens, category names and alias terms after each ingest and on demand; at query time a token with **zero**
   FTS hits is matched against it by bounded edit distance (≤ 1 for 4–5 letters, ≤ 2 for ≥ 6, no correction
   below 4 letters), best match by distance then document frequency, and the response carries
   "Showing results for *hackathon* (searched *hackthon*)". The correction is reported, never silent.
6. Aliases: expansion at query time (term → OR-group of expansions) and admin-only CRUD
   `GET/PUT/DELETE /api/v1/admin/search-aliases` (audited, `SEARCH_ALIAS_EXISTS` on a duplicate term).
7. Routes: `POST /api/v1/search/events` (body = `EventQuery`; POST because the query is a structured body,
   not because it writes) and `GET /api/v1/events/:id` returning the core event (identity, organizer,
   content, place, dates, team/fee, links, categories, sources) — **WP-16b extends this response** with
   claims, conflicts, deadlines timeline and change history; do not build those here.
8. Perf test — `tools/perf/search/`: a generator that seeds **20 000 synthetic events** (plus source records
   and categories) into a throwaway DB under `%LOCALAPPDATA%\CompIntel-dev\test-tmp`, from a **fixed seed**
   with an in-house PRNG so the corpus is byte-identical on every run (no faker, no `Math.random`). Script
   `pnpm perf:search`, **outside `pnpm verify`** (§4.15 budgets verify at < 2 min, R19's reasoning). It warms
   up 20 iterations, measures 200 per scenario (filters only · filters + text · text + distance · detail by
   id), prints p50/p95/p99 and the machine, and **exits non-zero** if any p95 misses the §8.3 budget
   **halved** for this build machine (Ryzen 7 5700 / 16 GB): filter + text p95 < **50 ms**, event detail
   < **25 ms**. Facets are WP-15b's; leave the scenario slot named and skipped.

TESTS (all in `pnpm verify` unless noted):
- contracts: every field accepted/rejected as specified; a strict-object violation fails; date-range and
  distance rules; `limit`/`text` bounds.
- A7: `from`/`to` produce inclusive Asia/Kolkata day bounds with a fake clock, including across a DST-free
  year boundary and for an event stored at 18:31 UTC (= next IST day).
- A6: a fee filter excludes unknown fees; `includeUnknown.fee` includes them; `freeOnly` **never** matches an
  unknown fee; one test per field (fee, teamSize, location, deadline); `maxDistanceKm` excludes ONLINE, and
  includes it (undistanced) when `modes` contains ONLINE.
- triggers (F6): insert → the event is findable; update the title → the old title no longer matches and the
  new one does; delete → no orphan rows in either index; a row inserted by a raw SQL path is indexed too.
- injection: `"` , `*`, `NEAR(`, `OR`, an unbalanced quote and a 200-char string all search literally and
  never error.
- typo AC: "hackthon" → hackathon and "cyber secuirty" → cybersecurity, both with the correction message;
  a term that **does** hit FTS is never corrected; a 3-letter typo is not corrected.
- trigram: "ackath" (a substring, not a prefix) finds "Hackathon"; a 2-char fragment does not.
- aliases: "ML" finds "machine learning" events and vice versa; deleting the alias reverses it.
- visibility: a POLICY_HIDDEN, an ADMIN_HIDDEN and a MERGED event never appear, with or without text.
- cursor: full pagination over a seeded set returns every row exactly once; a tampered cursor → 400
  `SEARCH_INVALID_CURSOR`.
- migrations: from an empty DB and from the previous release fixture DB, both indexes and all triggers exist.

ACCEPTANCE: `pnpm verify` green · `pnpm perf:search` green with its numbers pasted into the report (p50/p95/p99
per scenario, and say what the halved budgets were) · the typo AC demonstrated in the report output ·
`drizzle-kit push` still absent (the existing script test proves it) · `pnpm audit:deps` reported ·
files < 400 lines · no SQL outside `repo.ts`/migrations and no drizzle import under `domain/`.

OUT OF SCOPE: ranking, relevance reasons, facets, the category rules engine (WP-15b) · any UI (WP-16a/16b) ·
natural-language parsing (WP-25a) · saved-search evaluation (WP-24) · sqlite-vec / embeddings (§8.5, Phase 2) ·
provenance, conflicts and change history in the detail response (WP-16b).

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-15a.md, commit
"WP-15a: EventQuery, query builder, FTS5 + trigram, aliases, typo vocabulary", print the report). Anything the
spec leaves open goes under "Minor decisions"; anything architectural stops and goes under "Questions for the
architect".
