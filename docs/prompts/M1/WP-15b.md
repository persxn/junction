WP-15b — Category rules engine, facets, deterministic ranking and relevance reasons

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-15a.md · docs/handoff/WP-08a.md ·
docs/handoff/WP-08b.md · docs/handoff/WP-10.md · docs/adr/ADR-0006-search-fts5.md ·
docs/ARCHITECTURE.md §4.7, **§8 (all of it, §8.4 in particular)**, §6.2 ("Taxonomy", "Events",
`event_categories`, `user_interest_tags`), §7.4, §7.5 (field resolution / `has_conflicts`), §10.2
(the "Override an event's categories" and "categories & rules" rows), §12 (urgency thresholds), §17, §21 ·
docs/DECISIONS.md (**D-15**, **D-18**, D-06, D-08) · packages/contracts/src/{search,errors}.ts ·
apps/backend/src/modules/search/** · apps/backend/src/modules/events/** · apps/backend/src/db/** ·
apps/backend/src/platform/{time,settings}.ts · apps/backend/src/testing/** · tools/perf/search/**.
Do NOT read apps/desktop — there is no UI in this WP.

BINDING RULINGS AND DECISIONS:
- **D-15 — categories come from source tags + deterministic rules.** Admins edit the list and the rules;
  professors override per event; **manual beats rules, always**. **AI classification is Phase 2 and is out of
  scope here** — no model, no embeddings, no heuristic that cannot be printed as a sentence.
- **D-18 / §8.4 — ranking is deterministic and explainable.** Every ranked result carries **at least one
  human-readable reason**. That is this WP's acceptance criterion, so the reasons are part of the API
  contract, not something the UI derives later.
- Ranking weights and thresholds live in the **typed settings registry** (`settings.define(key, schema,
  default)`), not in constants scattered through the scorer.
- POLICY_HIDDEN / ADMIN_HIDDEN / MERGED events are invisible everywhere, **including facet counts** (§7.4).
- Time comes from the injectable `Clock` in `platform/time.ts`; "closing soon" must be testable with a fake clock.

BUILD:
1. contracts — extend `packages/contracts/src/search.ts`: `RelevanceReason` = {code, text, weightApplied}
   with a **closed** code enum (TEXT_MATCH · REGISTRATION_OPEN · CLOSING_SOON · WITHIN_RADIUS ·
   CATEGORY_MATCH · TAG_MATCH · TEAM_SIZE_FITS · TRUSTED_SOURCE · NO_CONFLICTS · RECENTLY_ADDED);
   `RankedEventListItem` = `EventListItem` + {score, reasons: RelevanceReason[] **`.min(1)`**} — an empty
   reason list must be impossible to serialize; `FacetValue` {value, label, count}, `Facets` {eventType,
   category, mode, registrationState, distanceBucket}. Plus `Category`, `CategoryRule` (kind
   KEYWORD|PHRASE|REGEX|SOURCE_TAG|EVENT_TYPE, pattern, fields TITLE|DESCRIPTION|TAGS|ALL, weight 0–100,
   isActive), `CategoryAssignment` (categoryId, origin SOURCE_TAG|RULE|MANUAL|AI, ruleId?, confidence,
   isSuppressed). Codes `SEARCH_INVALID_RULE`, `SEARCH_RULE_PATTERN_UNSAFE`, `CATEGORY_IN_USE`.
2. Schema: `categories`, `category_rules`, `event_categories` per §6.2 — if WP-08a already created them,
   add only what is missing (indexes on `event_categories.category_id`, `category_rules.category_id`,
   partial index for active rules) in a numbered migration; never `push`. Seed the starter taxonomy and its
   rules from a committed `resources/category-rules.seed.json` (AI/ML, Cybersecurity/CTF, Web, Mobile,
   Blockchain, Data Science, IoT/Hardware, Robotics, Design, Social Impact, Open Source, Competitive
   Programming) — the seed is data, applied idempotently, not code.
3. Rules engine (pure domain, `modules/categories/domain/classify.ts`): `classify(event, sourceTags, rules)
   → assignments[]`, deterministic and order-independent — sort rules by (weight desc, id) before applying so
   two runs on the same input produce byte-identical output. Field scoping per rule; KEYWORD matches whole
   normalized tokens (never substrings — "AI" must not match "Chair"); PHRASE matches a normalized phrase;
   REGEX is **guarded**: pattern ≤ 200 chars, compiled once with the `u` flag, rejected at write time with
   `SEARCH_RULE_PATTERN_UNSAFE` if it contains nested unbounded quantifiers, and each evaluation is bounded by
   a character budget so one bad rule cannot hang an ingest. Confidence = normalized summed weight, clamped
   0–1. SOURCE_TAG assignments record `origin = SOURCE_TAG`, rule hits `origin = RULE` + `rule_id`.
4. Application (`service.ts`): classify on ingest (hook into WP-08a/WP-10's write path) and re-classify on
   demand — an admin rule edit enqueues a **batched** re-classification over affected events (chunked,
   resumable, logged, never a whole-table lock). Re-classification **never touches a row whose origin is
   MANUAL and never resurrects `is_suppressed = true`** — assert this in a test that edits rules after a
   manual suppression.
5. Ranking (pure domain, `modules/search/domain/rank.ts`): `RELEVANCE` = normalized bm25 (only when `text` is
   present) + the §8.4 boosts — registration open · closing soon (§12 thresholds) · within the preferred
   radius · category/tag overlap with `user_interest_tags` · trusted/verified source (`sources.trust_rank`) ·
   low conflicts (`has_conflicts = false`). Every boost that fires **emits its reason with the rendered text**
   ("~120 km (straight line)", "Team size 2–4 fits", "Registration open until 27 Sep", "AI/ML matches your
   interests"). Deterministic tie-break (score desc, deadline asc, id asc). The non-RELEVANCE sorts
   (DEADLINE/START/DISTANCE/PRIZE/NEWEST) **still return reasons** — the reason for the sort key plus any boost
   that fired — so no code path can return an empty list. Weights/thresholds:
   `search.ranking.*` settings with the defaults documented in one block.
6. Facets: one CTE of matching event ids, reused for all five families in a single round trip — do not run the
   whole query five times. Each family is counted with **its own filter removed and every other filter
   applied** (so a user can see what switching to another type would give), while visibility, `excludeHidden`
   and `watchlistedOnly` are applied **before** counting, so a count never promises rows the list cannot show.
   Distance buckets are D-06's 50/100/250/500/Anywhere. Cap each family at the top 20 values + an "Other"
   bucket. State the counting rule in one comment and in the handoff — the UI copy depends on it.
7. Routes: `POST /api/v1/search/events` now returns ranked items with reasons **and** facets (facets skippable
   with `{facets:false}` for cheap callers); admin CRUD `GET/POST/PATCH/DELETE /api/v1/admin/categories` and
   `/admin/category-rules` (audited; deleting a category in use → `CATEGORY_IN_USE` unless `?reassign=`);
   `POST /api/v1/admin/category-rules/preview` returning the first 20 events a candidate rule would match
   **without writing anything** — an admin must be able to see a rule's blast radius before saving it.
8. Perf: add the facets scenario to `pnpm perf:search` (still outside `pnpm verify`) and assert the halved
   §8.3 budget on this build machine: facets p95 < **75 ms**; re-check that filter + text stays < 50 ms with
   ranking on.

TESTS (all in `pnpm verify` unless noted):
- **the acceptance criterion:** over the seeded corpus, for every sort and for queries with and without text,
  **no ranked result has an empty `reasons` array** — a fast-check property test over generated `EventQuery`s,
  plus a schema-level test that `reasons: []` fails zod.
- reasons are correct, not just present: a closing-soon event carries CLOSING_SOON with the right date text; a
  400 km event under a 500 km filter carries WITHIN_RADIUS with "~400 km (straight line)"; an event with
  `has_conflicts` does **not** carry NO_CONFLICTS.
- ranking determinism: the same query twice → identical order; changing one `search.ranking.*` setting changes
  the order in the documented direction; ties break identically across runs.
- rules engine: golden fixtures (`expectGolden`) for a dozen real titles per kind; KEYWORD does not match
  substrings; REGEX guard rejects a catastrophic pattern at write time; a source tag and a rule hitting the
  same category produce one row, not two.
- manual wins: a manual suppression survives a rule edit and a full re-classification; a MANUAL assignment is
  never downgraded to RULE.
- facets: each family's count equals the number of results actually returned when that value is applied as a
  filter; POLICY_HIDDEN, ADMIN_HIDDEN, MERGED and user-hidden events are absent from every count; a query with
  no matches returns all families with zero counts, not an empty object.
- permissions: a professor calling any `/admin/categor*` route gets 403; every admin write has an audit row.

ACCEPTANCE: `pnpm verify` green · **every ranked result carries at least one reason** (name the test) ·
`pnpm perf:search` green with facets, numbers pasted into the report · rule preview shown working on a real
rule in the report · `pnpm audit:deps` reported · files < 400 lines · no drizzle/SQL import under `domain/`.

OUT OF SCOPE: **AI or embedding-based classification (Phase 2, D-15)** · any UI, including the category chips
and the override control (WP-16b) · saved searches and their evaluator (WP-24) · recommendations on the
dashboard (WP-21) · natural-language query parsing (WP-25a) · changing WP-15a's FTS schema.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-15b.md, commit
"WP-15b: category rules, facets, ranking and relevance reasons", print the report). Anything the spec leaves
open goes under "Minor decisions"; anything architectural stops and goes under "Questions for the architect".
