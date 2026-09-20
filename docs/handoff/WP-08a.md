# WP-08a — Event schema, `EventCandidate`, normalization library

**Status: IN PROGRESS (~65%).** Everything committed is green — `pnpm verify` passes, **1979 tests**
(was 1790 at the end of pre-M1). Spec is at **v1.1.7**; rulings **R48–R52** are recorded.

> **Read this first if you are picking WP-08a up in a fresh session.** It is written for that, not as
> a closing report. §7 is the checklist of what is left; §5 is the list of traps that already cost
> time once.

## 1. Where the tree stands

| | |
|---|---|
| Branch | `main`, clean |
| Last commits | `b9a6408` WP-08a (wip) · `96dfd32` docs: rulings v1.1.7 |
| `pnpm verify` | green (~70 s) |
| Tests | 1979 passing in 76 files |
| `pnpm audit:deps` | not re-run since the three new dependencies landed — **run it** |
| Spec | ARCHITECTURE.md v1.1.7, §21 R1–R52 + R67–R69 |

## 2. STEP 0 — done

`docs/ARCHITECTURE.md` is at **v1.1.7** with the changelog row and **R48–R52** in the §21 table,
exactly as the prompt dictates them. The reserved row now reads **R53–R66** (WP-08b takes R53–R57).
`docs/PROGRESS.md` says "Next: WP-08b" but still has to be updated with WP-08a's own entry (§7.8).

## 3. What is built and green

### 3.1 Contracts

- **`packages/contracts/src/events.ts`** — `OrganizerKind`, `GeoPrecision`, `Visibility`,
  `Cancellation`, `ValueOrigin`, `DeadlineKind`, `Recurrence`, `ChangeCause`, `OverrideField`,
  `InstitutionKind`, plus `CurrencyCode` / `CountryCode` / `Instant` / `DatedValue` / `EventDeadline`
  and the read DTOs `EventSummary` and `EventDetail`. `EventType`, `EventMode` and `DatePrecision`
  are re-exported from `enums.ts` (they predate this WP).
- **`packages/contracts/src/event-candidate.ts`** — `uncertain()` (R51), `Uncertain<T>`,
  `PARSE_WARNING_CODES` / `ParseWarning`, `CandidateDate`, `CandidateDeadline`,
  `CandidateEligibility`, `CandidatePlace`, `CandidateFee`, `CandidateTeamSize`, `CandidatePrize`
  and `EventCandidate`. **`.strict()` at every level** — that is the enforcement point for R50.
- **`errors.ts`** — `EVENT_INVALID_CANDIDATE` and `EVENT_VERSION_CONFLICT` added.
  `EVENT_STALE_VERSION` was **renamed** to `EVENT_VERSION_CONFLICT`; nothing consumed it, the prompt
  names the latter, and keeping both would have been two codes for one 409.
- Both files are exported from `packages/contracts/src/index.ts`.

### 3.2 Schema and migration

`apps/backend/migrations/0004_blushing_miss_america.sql`, generated with `db:generate` (never
`push`), with a hand-written header explaining R49. Drizzle sources:

- `src/db/schema/events.ts` — `event_series` and `events`. The `events` table follows §6.2 column for
  column through all ten groups and carries the nine listed indexes in §6.2's order, plus CHECKs
  generated from the contracts enum lists.
- `src/db/schema/event-provenance.ts` — `event_deadlines`, `event_field_claims`, `event_overrides`,
  `event_changes`.
- `src/db/schema/institutions.ts` — `institutions`, created empty for WP-08b to seed.
- All four exported from `src/db/schema/index.ts`.

The existing `src/db/migrations.test.ts` passes against 0004, but it does **not yet assert anything
about the new tables** — that is §7.2.

### 3.3 The normalization library

`apps/backend/src/domain/normalize/`, all pure and clock-injected (R52), all under 400 lines:

`warnings.ts` · `urls.ts` · `redact.ts` · `text.ts` · `dates.ts` · `fees.ts` · `team-size.ts` ·
`mode.ts` · `event-type.ts` · `recurring.ts` · `edition-year.ts` · `index.ts`
(`normalizeCandidate(raw, ctx)` → `{ candidate, warnings }`).

### 3.4 Tests that exist

- **`src/domain/normalize/normalize.test.ts`** — the table runner. 153 cases across five families
  plus six cross-cutting invariants. Asserts `ALL_CASES.length >= 100` and that all ten §7.3-named
  cases are present by name.
- **`src/domain/normalize/cases/*.ts`** — the cases, as pure data. Counts: **dates 35 · money 33 ·
  classify 36 · text 39 · shape 10 = 153.**
- **`packages/contracts/src/event-candidate.test.ts`** — 27 tests: R50 refusals field by field,
  `uncertain()`'s confidence bounds, and the cross-field invariants.

## 4. Decisions taken that the architect should see

1. **`OverrideField` is a closed enum.** §6.2 leaves `field` an open column on
   `event_overrides` / `event_field_claims` / `event_changes`. It is closed here (40 values) because
   those three tables are the provenance trail WP-10 resolves conflicts from, and a free-text field
   name means two sources writing `startsAt` and `starts_at` never disagree with each other. Computed
   (`quality_score`), structural (`id`, `version`) and other-subsystem (categories, tags) columns are
   deliberately absent.
2. **`EVENT_STALE_VERSION` → `EVENT_VERSION_CONFLICT`** (see §3.1).
3. **`events.merged_into_event_id` is a self-referencing FK.** Drizzle needs the column annotated
   `AnySQLiteColumn` and the *table* left un-annotated; annotating the table erases the column types.
4. **A record with no dates at all gets no `TIMEZONE_ASSUMED` warning.** Warning that UTC was assumed
   for dates that do not exist is noise, and noise is how real warnings stop being read.
5. **`resultAt` is a first-class candidate field**, not just an `event_deadlines` row, because §6.2
   gives `event_deadlines` a `RESULT` kind and adapters routinely surface it alongside the start/end.
6. **Case files are pure data.** `expect` is a declarative `{ fields, lessThan, warnings, noWarnings,
   absent }` with dotted paths, so nothing under `src/domain/**` imports vitest and the 400-line rule
   applies to them like any other source file.

## 5. Traps — read before writing code

1. **Never let a shell heredoc write a regex.** Two regexes in `text.ts` were silently corrupted by
   `\b` becoming a literal backspace (0x08) and `̀` becoming literal combining marks. The
   `BLOCK_BOUNDARY` regex then matched nothing and the bug took half an hour to find because the
   source *looked* right. Use the Write/Edit tools for anything containing backslashes, and sweep
   with `grep -rlP '[\x00-\x08\x0b\x0c\x0e-\x1f]' apps packages` if in doubt.
2. **`Date.parse` on an offset-free timestamp uses the host machine's zone.** This box is IST, so
   `Date.parse('2026-10-01T10:00:00')` already returns the IST instant. `dates.ts` now parses naive
   date-times with an explicit `NAIVE_DATETIME` regex and resolves them through `toUtcInstant`. Do
   not reintroduce `Date.parse` for that shape — it would pass here and fail on a UTC machine.
3. **`pnpm typecheck` before `db:generate`.** drizzle-kit loads the contracts package's built `dist`;
   a stale build makes the CHECK-constraint helpers read `undefined`.
4. **`drizzle-kit push` is banned** and `scripts.test.ts` fails if any manifest adds it.
5. The fee regex must keep its leading `\d`: `[\d,]+` let the comma in "students, ₹500" match as the
   amount, which reported a ₹500 event as free.
6. `pnpm verify` takes ~70 s now; the desktop `auth-flow` test has flaked once under full-suite load
   and passes on its own.

## 6. New dependencies

| Package | Version | Why |
|---|---|---|
| `chrono-node` | 2.10.1 | §4.8 names it. Step 3 of the date order — prose only, after structured values and source patterns. Its reference instant is the injected clock, never `new Date()`. |
| `sanitize-html` | 2.17.7 | The allowlist gate for §7.3's "no raw HTML stored". Runs **before** Turndown, so nothing unapproved reaches the converter. Works in Node without a DOM. |
| `turndown` | 7.2.4 | HTML → Markdown, after sanitizing. |
| `@types/sanitize-html` | 2.16.1 | dev |
| `@types/turndown` | 5.0.6 | dev |

All pinned exact. `fast-check` still has to be added (dev) for §7.5.

## 7. What is left — the checklist

### 7.1 Enum ↔ CHECK tests
A test per enum asserting the contracts list matches the CHECK constraint the migration wrote. Read
the constraint text out of `sqlite_master` and compare against the exported array; that catches a
value added to contracts without a migration, which is the failure this is for.

### 7.2 Migration tests (in `src/db/migrations.test.ts`, or a sibling)
- On an empty DB **and** on top of 0003.
- Every `events` column and index from §6.2 exists — assert against an **explicit expected list**,
  not a snapshot.
- Each CHECK rejects an out-of-enum value.
- Money columns accept NULL and reject a negative.
- `events.series_id` FK **is** enforced; `event_field_claims.source_record_id` is **not** (R49).
  Note `PRAGMA foreign_keys` is on — see `platform/db.ts`.

### 7.3 PII sweep over the fixtures
Every string in `apps/backend/test/fixtures/**` (the copies pre-M1 made of
`docs/research/fixtures/**`) through `redact()` → no e-mail and no phone match. Walk the parsed JSON
recursively; `hasContactDetails()` in `redact.ts` is the predicate. This is the §19 acceptance
criterion, so it needs to fail loudly if a fixture is ever replaced with a dirtier one.

### 7.4 Golden files
`expectGolden()` (pre-M1's `src/testing/golden.ts`) for the sanitized-Markdown and summary output of
**the two real descriptions** in the ctftime and devfolio fixtures. Record once with
`UPDATE_GOLDEN=1 pnpm test` and **review the recorded file in the same commit** — a golden nobody
read is a bug nobody noticed.

### 7.5 Property test (fast-check)
`pnpm --filter @compintel/backend add -D fast-check@<pin>`. Two properties:
- for any wall-clock date + IANA zone, local → UTC ms → local round-trips;
- a parsed range never has `ends_at < starts_at`.

### 7.6 Acceptance sweep
`pnpm verify` green · ≥ 100 cases with all ten named ones (already true) · no e-mail or phone
survives redaction on any fixture · the `events` table matches §6.2 exactly · `db:generate` used, no
`push` · **`pnpm audit:deps` — not yet run since the new dependencies** · files < 400 lines ·
nothing under `src/domain/**` imports drizzle, better-sqlite3, fastify or `node:fs` (the linter
already enforces this — confirm it is still clean).

### 7.7 Out of scope — do not drift into these
Any `SourceAdapter` or network call (WP-09b) · `source_records`, the compliance gate, scrape jobs
(WP-09a) · geocoding, the gazetteer, institutions **data**, the geography and event-type policies
(WP-08b) · dedup/merge (WP-10) · FTS5 (WP-15a) · categories and tags (WP-15b) · any route or UI.
**Wire nothing.** The migration and the library are the deliverable.

### 7.8 Close out
1. `pnpm verify` green.
2. `docs/PROGRESS.md`: a WP-08a entry of ≤ 10 lines, file **< 150 lines** — it is at exactly 150 now,
   so an older Completed entry has to be compressed first. Update the roadmap line to 17 done / 31
   remaining and set "Next" to WP-08b.
3. Rewrite this file as the closing report (status DONE, the case count per family, the new
   dependencies, and any §6.2 column whose type or nullability had to be interpreted — §8 below has
   the start of that list).
4. Commit `WP-08a: event schema, EventCandidate contract and the normalization library`.
5. Print the report per CLAUDE.md, under 80 lines.

## 8. §6.2 columns whose type or nullability had to be interpreted

Carry these into the closing report and extend the list if more turn up.

| Column | §6.2 says | Interpreted as | Why |
|---|---|---|---|
| `events.geo_precision` | no nullability | `NOT NULL DEFAULT 'UNKNOWN'` | The enum has an `UNKNOWN` member, so a NULL would be a second way to say the same thing. |
| `events.organizer_kind` | no nullability | `NOT NULL DEFAULT 'UNKNOWN'` | Same. |
| `events.date_precision`, `registration_deadline_precision` | no nullability | `NOT NULL DEFAULT 'UNKNOWN'` | Same; a date without a precision is exactly what ADR-0015 forbids. |
| `events.eligibility_json` | "flags with confidence" | nullable TEXT holding JSON | No JSON type in SQLite; the shape is `CandidateEligibility`. |
| `events.quality_score` | "(0–100)" | `NOT NULL DEFAULT 0` + CHECK | WP-10 computes it; 0 means "not scored yet", which is honest for a fresh row. |
| `events.summary` | "plain text ≤ 500 chars" | nullable + `length(...) <= 500` CHECK | The limit is stated, so it is enforced rather than trusted. |
| `event_field_claims.value_json` | not stated | **nullable** | A source claiming a field is empty is a claim, and it has to be distinguishable from no claim. |
| `event_deadlines.created_at/updated_at` | absent from §6.2 | added | §6.1 says "`created_at`, `updated_at` wherever meaningful"; a deadline row changes when a source moves it. |
| `event_series.created_at/updated_at` | absent from §6.2 | added | Same. |
