# WP-08a — Event schema, `EventCandidate`, normalization library

**Status: DONE** · 21 Sep 2026 · spec v1.1.7, rulings **R48–R52** · `pnpm verify` green,
**2038 tests** (1790 at the end of pre-M1).

The migration and the library are the deliverable. Nothing is wired: no routes, no service, no
repository, no job, no UI. WP-08b is the first caller.

## 1. What shipped

### 1.1 Contracts

- **`events.ts`** — `OrganizerKind`, `GeoPrecision`, `Visibility`, `Cancellation`, `ValueOrigin`,
  `DeadlineKind`, `Recurrence`, `ChangeCause`, `OverrideField`, `InstitutionKind`, plus
  `CurrencyCode` / `CountryCode` / `Instant` / `DatedValue` / `EventDeadline` and the read DTOs
  `EventSummary` and `EventDetail`. `EventType`, `EventMode` and `DatePrecision` are re-exported from
  `enums.ts`.
- **`event-candidate.ts`** — `uncertain()` (R51), `PARSE_WARNING_CODES` / `ParseWarning`,
  `CandidateDate`, `CandidateDeadline`, `CandidateEligibility`, `CandidatePlace`, `CandidateFee`,
  `CandidateTeamSize`, `CandidatePrize`, `EventCandidate`. **`.strict()` at every level**, which is
  how R50 stops being a promise and becomes a schema.
- **`errors.ts`** — `EVENT_INVALID_CANDIDATE` added; `EVENT_STALE_VERSION` renamed to
  `EVENT_VERSION_CONFLICT` (nothing consumed it, and two codes for one 409 is one too many).

### 1.2 Schema — migration `0004`

`event_series`, `events`, `event_deadlines`, `event_field_claims`, `event_overrides`,
`event_changes`, `institutions` — one migration, per R48. Generated with `db:generate`; `push` is
still banned and `scripts.test.ts` still enforces that. The header explains R49 in place.

`events` follows §6.2 column for column across all ten groups and carries the nine listed indexes.
CHECK constraints are generated from the contracts enum arrays, so the three copies of an enum — zod,
the TypeScript union, the database — cannot drift apart silently.

### 1.3 Normalization — `src/domain/normalize/`

Twelve modules, all pure and clock-injected (R52), all under 400 lines: `warnings` · `urls` ·
`redact` · `text` · `dates` · `fees` · `team-size` · `mode` · `event-type` · `recurring` ·
`edition-year` · `index` (`normalizeCandidate(raw, ctx)` → `{ candidate, warnings }`).

## 2. Tests

| Suite | What it covers |
|---|---|
| `domain/normalize/normalize.test.ts` | The **156-case table**, plus six cross-cutting invariants. Asserts `ALL_CASES.length >= 100` and that all ten §7.3-named cases are present *by name*, so one cannot be renamed away. |
| `domain/normalize/cases/*.ts` | The cases, as pure data — no vitest import, so the 400-line rule and the domain import rules apply to them like any other source. |
| `domain/normalize/dates.property.test.ts` | fast-check: local ↔ UTC round-trips over ten zones; a parsed range never ends before it starts; combined precision is never finer than either end. |
| `db/events-schema.test.ts` | 38 tests: columns, indexes, every enum CHECK against its contracts array, every CHECK shown refusing something, and the foreign keys. |
| `testing/normalize-fixtures.test.ts` | The §19 criterion, plus the two goldens. |
| `contracts/event-candidate.test.ts` | R50 field by field, `uncertain()`'s bounds, the cross-field invariants. |

**Cases per family:** dates 35 · money 33 · classify 36 · text 42 · shape 10 — **156**.

## 3. Three bugs the tests found

Worth reading, because each was invisible in review and none would have failed loudly in production.

1. **A ₹500 event reported as free.** The fee pattern was `[\d,]+`, so the comma in
   "students, ₹500" matched as the amount and parsed to zero. Now `\d[\d,]*`.
2. **Dates parsed in the host machine's timezone.** `Date.parse('2026-10-01T10:00:00')` resolves an
   offset-free timestamp in the *host's* zone. This box is IST, so it already returned the IST
   instant and the code then shifted it again. It passed here and would have failed on a UTC build
   machine. `dates.ts` now parses naive date-times with an explicit regex and resolves them through
   `toUtcInstant`.
3. **Markdown rendered as literal backslashes.** The Devfolio fixture sends **Markdown**, not HTML,
   and Turndown escapes Markdown syntax it finds in its input — correct for HTML, wrong here. Every
   `**bold**` became `\*\*bold\*\*`. Found by reading the recorded golden, which is the entire reason
   for recording one. Text containing no tag now skips the HTML path.

Two of the three came from the case table and the golden review; the third came from a case written
to pin behaviour that turned out not to hold.

## 4. Decisions the architect should see

1. **`OverrideField` is a closed enum (40 values).** §6.2 leaves `field` open on
   `event_overrides` / `event_field_claims` / `event_changes`. Closed here because those three tables
   are the provenance trail WP-10 resolves conflicts from, and a free-text field name means two
   sources writing `startsAt` and `starts_at` never disagree with each other. Computed
   (`quality_score`), structural (`id`, `version`) and other-subsystem (categories, tags) columns are
   deliberately absent — there is nothing to override.
2. **`EVENT_STALE_VERSION` → `EVENT_VERSION_CONFLICT`.**
3. **`GEO_COORDINATES_INVALID` kept over the prompt's `GEO_INVALID_COORDINATES`** — pre-M1 already
   shipped the former and nothing depends on the spelling.
4. **A record with no dates gets no `TIMEZONE_ASSUMED` warning.** Warning about dates that do not
   exist is noise, and noise is how real warnings stop being read.
5. **`resultAt` is a first-class candidate field**, not only an `event_deadlines` row: §6.2 gives the
   table a `RESULT` kind and adapters surface it alongside the start and end.
6. **`events.merged_into_event_id` is a self-referencing FK.** Drizzle needs the *column* annotated
   `AnySQLiteColumn` and the table left un-annotated.

## 5. §6.2 columns whose type or nullability had to be interpreted

| Column | §6.2 says | Interpreted as | Why |
|---|---|---|---|
| `events.geo_precision` | no nullability | `NOT NULL DEFAULT 'UNKNOWN'` | The enum has an `UNKNOWN` member; a NULL would be a second way to say it. |
| `events.organizer_kind` | no nullability | `NOT NULL DEFAULT 'UNKNOWN'` | Same. |
| `events.date_precision`, `registration_deadline_precision` | no nullability | `NOT NULL DEFAULT 'UNKNOWN'` | A date without a precision is what ADR-0015 forbids. |
| `events.eligibility_json` | "flags with confidence" | nullable TEXT holding JSON | No JSON type in SQLite; the shape is `CandidateEligibility`. |
| `events.quality_score` | "(0–100)" | `NOT NULL DEFAULT 0` + CHECK | WP-10 computes it; 0 means "not scored yet". |
| `events.summary` | "plain text ≤ 500 chars" | nullable + `length(...) <= 500` CHECK | The limit is stated, so it is enforced rather than trusted. |
| `event_field_claims.value_json` | not stated | **nullable** | "This source says the field is empty" is a claim, distinct from no claim. |
| `event_deadlines`, `event_series` `created_at`/`updated_at` | absent | added | §6.1: "wherever meaningful" — a deadline row changes when a source moves it. |

## 6. New dependencies

| Package | Version | Why |
|---|---|---|
| `chrono-node` | 2.10.1 | §4.8 names it. Step 3 of the date order — prose only, after structured values and source patterns. Its reference instant is the injected clock. |
| `sanitize-html` | 2.17.7 | The allowlist gate for §7.3's "no raw HTML stored". Runs **before** Turndown, so nothing unapproved reaches the converter. No DOM needed. |
| `turndown` | 7.2.4 | HTML → Markdown, after sanitizing. |
| `@types/sanitize-html` | 2.16.1 | dev |
| `@types/turndown` | 5.0.6 | dev |
| `fast-check` | 4.10.2 | dev — §4.15 names it for dates. |

All pinned exact. `pnpm audit:deps`: no known vulnerabilities.

## 7. Acceptance

- `pnpm verify` green — Prettier, ESLint, `tsc -b`, **2038 tests in 79 files** (~75 s).
- **156 cases**, all ten §7.3-named ones present and asserted by name.
- No e-mail and no phone survives redaction on any committed fixture, and the sweep is shown to fail
  if one is introduced.
- The `events` table matches §6.2 exactly, asserted against an explicit list.
- `db:generate` used; `drizzle-kit push` absent from every manifest.
- `pnpm audit:deps` clean. No source file over 400 lines. Nothing under `src/domain/**` imports
  drizzle, better-sqlite3, fastify or `node:fs` — the linter caught one attempt while this WP was
  being written, and the file moved rather than the rule bending.

## 8. Known issues and notes for the next WP

- **`quality_score` is not computed.** The column exists, defaults to 0 and has its CHECK; WP-08b
  fills it with a provisional pure function, WP-15b/16b tune it.
- **`institutions` is empty.** Created for the FK to point at; WP-08b seeds it.
- **`source_record_id` has no FK by design (R49).** `events-schema.test.ts` records that as
  deliberate — deleting that test is the deliberate act required to change it.
- **WP-08b's STEP 0 is already done.** The spec is at **v1.1.8** with **R53–R57** recorded, and
  §21's reservation now reads R58–R66. WP-08b should skip its STEP 0 (a) and (b) and start at BUILD;
  its STEP 0 (c), the PROGRESS.md line, is still open. Q12 remains OPEN in both ARCHITECTURE.md §2
  and DECISIONS.md, unchanged.
- The desktop `auth-flow` test has flaked once under full-suite load and passes on its own.

## 9. Traps worth carrying forward

1. **Never let a shell heredoc write a regex or a string with escapes.** Two regexes in `text.ts` were
   silently corrupted — `\b` became a literal backspace (0x08) and `̀` became literal combining
   marks — and the source *looked* right. Use the Write/Edit tools for anything with backslashes, and
   sweep with `grep -rlP '[\x00-\x08\x0b\x0c\x0e-\x1f]' apps packages` if in doubt.
2. **`pnpm typecheck` before `db:generate`** — drizzle-kit loads the contracts package's built `dist`.
3. Record a golden, then **read it in the same commit**. Both of this WP's subtler bugs were visible
   in one and invisible everywhere else.
