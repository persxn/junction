WP-08a — Event schema, the `EventCandidate` contract, and the normalization library (dates/tz, fees, team size, mode, event type, edition_year, text, URLs, PII redaction)

Fresh session. Read ONLY: docs/PROGRESS.md · the newest file in docs/handoff/ (the pre-M1 consolidation
WP — it added `platform/time.ts`, `src/domain/` with its import-boundary rule, `platform/audit.ts`,
`testing/golden.ts` and the `max-lines: 400` rule) · docs/ARCHITECTURE.md §6.1, §6.2 (the **Events**
tables, the `events` column groups, and `institutions` under "Places"), §7.1, §7.3 (every bullet),
§7.4 (the event-type paragraph), §3.3, §4.15, §21 (**R-rows and A-rows bind and beat section text**;
A11 in particular) · docs/adr/ADR-0015-time-utc-iana-precision.md · docs/DECISIONS.md (D-08, D-29,
D-31) · packages/contracts/src/{index,enums,errors}.ts · apps/backend/src/platform/{time,audit}.ts ·
apps/backend/src/{db/schema/*.ts,testing/golden.ts} · apps/backend/migrations/ · docs/research/fixtures/**.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.7"):
a) Version line → "**Version:** 1.1.7"; changelog row
   "| 1.1.7 | 20 Sep 2026 | Rulings R48–R52: event schema, EventCandidate, normalization (see §21). |"
   If the pre-M1 WP already took 1.1.7 or R48+, use the next free version and R numbers throughout.
b) Append to the §21 table:
| R48 The event schema lands whole | One migration creates `event_series`, `events`, `event_deadlines`, `event_field_claims`, `event_overrides`, `event_changes` and `institutions`. WP-10 (merge/conflicts) and WP-16b (provenance drawer) read the claim/override/change tables, so splitting one schema across three WPs costs more than it saves. Taxonomy joins (`event_categories`, `event_tags`) go with WP-15b, `dedup_candidates` with WP-10, per-user state with WP-16a, FTS with WP-15a. | §6.2, §19 |
| R49 Provenance columns carry no foreign key | `source_record_id` on `event_deadlines`, `event_field_claims` and `event_changes` is unconstrained TEXT: `source_records` arrives in WP-09a. The relation is enforced in the repository and documented in the migration header; WP-09a does **not** rebuild these tables to add the constraint. | §6.2, WP-09a |
| R50 `EventCandidate` has no people | D-29 is a schema guarantee, not a runtime filter: the zod object is `.strict()`, so `contactEmail`, `organizerEmail`, `participants`, `judges`, `mentors`, `contacts` or `phone` make validation **fail** rather than being quietly dropped. Runtime redaction (§7.3) applies only to free text. | §7.1, §7.3, D-29 |
| R51 Uncertainty is one helper | `uncertain(schema)` → `{ value, confidence: 0–1, raw?: string }` wraps every field §7.1 calls uncertain (dates, fee, team size, mode, event type, eligibility). A field that cannot be parsed is **absent**; a guessed value with a low confidence is never emitted. | §7.1 |
| R52 Normalization is pure and clock-injected | Everything under `src/domain/normalize/**` is I/O-free and takes the `Clock` from `platform/time.ts` — no `new Date()`, no `Date.now()`, no network, no DB. Date resolution order is structured source value → source-specific pattern → chrono-node, never the other way round. | §3.3, §7.3, ADR-0015 |
c) PROGRESS.md "Current": next WP is WP-08b; roadmap 16 done, 32 remaining (48 WPs: the count includes pre-M1 and WP-33).

BUILD:
1. contracts — `packages/contracts/src/events.ts`: the enums from §6.2 (`EventType`, `OrganizerKind`,
   `Mode`, `GeoPrecision`, `DatePrecision` re-exported from the time layer, `Visibility`,
   `Cancellation`, `DeadlineKind`, `Recurrence`, `ChangeCause`, `OverrideField`) and the DTOs
   `EventSummary` / `EventDetail` (read shapes only — no routes yet). Add `EVENT_ERROR_CODES`
   (`EVENT_INVALID_CANDIDATE`, `EVENT_NOT_FOUND`, `EVENT_VERSION_CONFLICT`) to the `EVENT_` block in
   `errors.ts` (R12). A test per enum that the list matches the CHECK constraints in step 3.
2. contracts — `packages/contracts/src/event-candidate.ts`: the `uncertain()` helper (R51), `ParseWarning`
   (`{ code, field?, message }` with a closed `code` enum), and `EventCandidate` covering §7.1: source
   key + external key + url, title and `titleRaw`, event type, organizer name/kind, summary and
   `descriptionMd`, mode, venue/city/state/countryCode/lat/lon **as stated by the source**, timezone,
   the six date fields each with its precision and raw text, team min/max, fee, prize, eligibility text
   and flags, official/registration URLs, `editionYear`, `isRecurringRound`, `seriesHint`, source tags,
   and `warnings[]`. `.strict()` everywhere (R50).
3. Migration (next free number, expect `0004_*`) via `pnpm --filter @compintel/backend db:generate` —
   **never `drizzle-kit push`**; run `pnpm typecheck` first so drizzle-kit loads a fresh contracts
   `dist`. Drizzle schema files under `src/db/schema/`, one per table group. `events` must match §6.2
   **column for column** (Identity, Organizer, Content, Format & place, Dates, Team & fee, Links,
   State, Quality, Audit) plus the nine listed indexes. Also
   `event_series`, `event_deadlines`, `event_field_claims`, `event_overrides`, `event_changes`,
   `institutions` (R48; WP-08b seeds it). Enums are TEXT + CHECK from the contracts lists (§6.1);
   money is minor units + currency, unknown is NULL (never 0); `fee_known` is an explicit boolean.
   `events.series_id`, `events.host_institution_id` and `events.merged_into_event_id` get real FKs;
   the `source_record_id` columns do not (R49) — say so in a header comment.
4. `apps/backend/src/domain/normalize/` — the bulk of this WP, one file per family, all pure (R52):
   `dates.ts` (timezone precedence explicit > venue (IN → Asia/Kolkata) > source default > UTC with the
   precision lowered; a date-only deadline is the inclusive end of that day in the event timezone, via
   the time layer's day-bounds helper; end-before-start or a year outside `now − 1 … now + 5` drops the
   field with a warning — never guessed) · `fees.ts` ("Free"/"₹0"/"No registration fee" → known 0;
   "₹500 per team" → 50000 minor INR + note; two currencies in one string → unknown + both kept in
   `feeText` + a warning; **never convert currencies**) · `team-size.ts` ("1–4", "up to 4", "teams of 4",
   "solo or teams of 2") · `mode.ts` (explicit > keywords > UNKNOWN; online keywords **and** a venue →
   HYBRID) · `event-type.ts` (source type > keyword rules > OTHER) · `recurring.ts` (series detection:
   "Codeforces Round #N", "Weekly/Biweekly Contest N", "Div. 2", "Starters N" → `isRecurringRound` +
   `seriesHint` with the number stripped) · `text.ts` (HTML → sanitized Markdown with an allowlist, no
   raw HTML stored, plain-text `summary` ≤ 500 chars on a word boundary) · `urls.ts` (http/https only,
   strip `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`; lower-case host; drop the
   fragment and a default port) · `edition-year.ts` (A11: start year > registration-deadline year >
   a 2020–2100 year in the title; title vs start disagreement → start wins + a warning) ·
   `redact.ts` (D-29: e-mails and phone numbers — `+91`, spaced or hyphenated groups, ≥ 7 digits — in
   any free text become "[contact details on the source page]", consecutive replacements collapsing to
   one) · `warnings.ts` · `index.ts` (`normalizeCandidate(raw, ctx)` → `{ candidate, warnings }`).
   Dependencies: `chrono-node` (§4.8) plus one sanitizer and one HTML→Markdown converter, pinned
   exact; justify each in the report and run `pnpm audit:deps`.
5. Wire nothing. No routes, no service, no repository, no job, no UI. The migration and the library are
   the deliverable; WP-08b is the first caller.

TESTS (all in pnpm verify):
- **The table-driven suite is the acceptance criterion.** `src/domain/normalize/cases/*.ts` export
  `{ name, input, expect }` arrays; one runner asserts `ALL_CASES.length >= 100` so the count cannot
  rot. The clock is fixed at `2026-09-20T09:00:00Z` for every case.
  Named cases that must be present, each with its own row: **end before start** · **a start year far in
  the future** (2087) · **a date-only registration deadline** (asserts the instant is 23:59:59.999 in
  Asia/Kolkata, precision DATE) · **an unparseable timezone** (`"IST+5.30"` → not a valid IANA zone →
  fall through to the venue rule, precision lowered, warning) · **a fee quoted in two currencies**
  ("₹500 / $10") · **"solo or teams of 2"** · **a title year that disagrees with the start year**
  ("HackX 2025" starting in Jan 2026) · **an e-mail inside a description** · **a phone number with
  spaces and `+91`** · **an `EventCandidate` whose every optional field is absent** (must validate and
  normalize to a candidate with no invented values).
- Negative redaction: a 4-digit year, "₹50,000", a prize table and a URL containing digits are **not**
  redacted; `redact()` is idempotent.
- PII sweep over the committed fixtures: every string in `docs/research/fixtures/**` (copied into
  `test/fixtures/`) through `redact()` produces no e-mail and no phone match. Golden files
  (`expectGolden`) for the sanitized-Markdown and summary output of the two real descriptions.
- Contracts: `EventCandidate` rejects `contactEmail`, `participants`, `judges`, `mentors` and `phone`
  (R50); `uncertain()` rejects a confidence outside 0–1.
- Migration tests in the existing suite: on an empty DB and on top of the previous migration; every
  `events` column and index from §6.2 exists (assert against an explicit expected list, not a snapshot);
  each CHECK rejects an out-of-enum value; money columns accept NULL and reject a negative; the FK
  from `events.series_id` is enforced and `source_record_id` is not (R49).
- Property test (fast-check, §4.15): for any wall-clock date + IANA zone, local → UTC ms → local
  round-trips; a parsed range never has `ends_at < starts_at`.

ACCEPTANCE: `pnpm verify` green · ≥ 100 normalization cases, all ten named cases present · no e-mail or
phone survives redaction on any fixture (the §19 criterion) · the `events` table matches §6.2 exactly ·
`db:generate` used, no `push` · `pnpm audit:deps` reported · files < 400 lines · nothing under
`src/domain/**` imports drizzle, better-sqlite3, fastify or `node:fs`.

OUT OF SCOPE: any `SourceAdapter` implementation and any network call (WP-09b is the first adapter);
`source_records`, the compliance gate and scrape jobs (WP-09a); geocoding, the gazetteer, institutions
data and the geography/event-type policies (WP-08b); dedup/merge and field resolution (WP-10); FTS5
tables, their triggers and the query builder (WP-15a); categories and tags (WP-15b); any route or UI.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-08a.md, commit
"WP-08a: event schema, EventCandidate contract and the normalization library", print the report).
Report the case count per family, the two new dependencies with versions, and any §6.2 column whose
type or nullability you had to interpret.
