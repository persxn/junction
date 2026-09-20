pre-M1 — Consolidation refactor before the events milestone (time layer, layer boundaries, audit unit-of-work, module-owned settings, golden fixtures, M0 tech debt)

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/M0.md · docs/handoff/M0-review.md ·
docs/ARCHITECTURE.md §3.3, §3.4, §4.15, §6.1, §21 (R1–R47) · docs/adr/ADR-0015-time-utc-iana-precision.md ·
apps/backend/src/** · packages/contracts/src/*.ts · eslint.config.js · vitest.config.ts ·
package.json (root + every workspace manifest).

Why this WP exists: M1 adds thirteen work packages of event ingestion, normalization and search on top of
M0's foundation. Five things in that foundation are fine for one module and wrong for thirteen — time
handling, layer boundaries, audit writing, settings ownership and fixture comparison. Fixing them costs
a day now and would cost a week spread across M1. **This WP changes no behaviour.** Nothing the UI does
may look different afterwards.

STEP 0 — This WP writes no rulings. The owner ships `docs/` already at **v1.1.6** with
`docs/handoff/M0-review.md` and `docs/prompts/` reorganized by milestone. Verify that before touching
code: if ARCHITECTURE.md is older than 1.1.6, or §21 stops before R47, **stop and ask the owner for the
current docs.zip** — the M1 prompts assume v1.1.6 and reserve R48–R66 for their own STEP 0 blocks.

BUILD — in this order, one commit each, `pnpm verify` green after every one:

1. **Time layer — `apps/backend/src/platform/time.ts`.** M1 is roughly half date logic (§7.3), and it
   must not be invented five times by five adapters.
   - `Clock` = `{ now(): Date }`, plus `systemClock`, `fixedClock(iso)` and `advancingClock(iso, stepMs)`
     for tests. No new dependency: timezone work goes through `Intl.DateTimeFormat` with `timeZone`.
   - `APP_TIMEZONE = 'Asia/Kolkata'` (A7) · `isValidTimeZone(tz)` (an unknown IANA name is **rejected**,
     never silently treated as UTC) · `offsetMinutesAt(tz, instant)` · `toUtcInstant(parts, tz)` ·
     `zonedDayBounds(tz, 'YYYY-MM-DD')` → the inclusive local day as `[startUtc, endUtcExclusive)` ·
     `endOfDayIn(tz, day)` (what a date-only deadline means, §7.3) · `formatDay(tz, instant)`.
   - `DatePrecision` lives in contracts and is re-exported here, so `events.date_precision` and the
     normalizer cannot drift apart.
   - Then **replace every ad-hoc `now?: () => Date` parameter** in `modules/**`, `jobs/**` and
     `platform/migrate.ts` with the `Clock`. Same behaviour, same tests, fewer shapes.
2. **Layer boundaries (§3.3) — mechanical, not conventional.**
   - Create `apps/backend/src/domain/` with a README stating the rule: pure functions, no I/O, no
     framework. Move the pure logic that already exists into it (there is little — the point is that the
     address exists before M1 fills it with normalization, dedup scoring, the query DSL and geo maths).
   - ESLint, using `no-restricted-imports` patterns (**do not add a plugin**): `src/domain/**` may not
     import `drizzle-orm`, `better-sqlite3`, `fastify`, `pino`, `node:fs`, `node:path` or anything under
     `src/db/`; route files may not import `src/db/**` directly (they go through a service);
     `packages/contracts/**` may not import from `apps/**`.
   - Add `max-lines: ['error', 400]` over `apps/*/src/**` and `packages/*/src/**`, tests exempt. The
     "files < 400 lines" acceptance criterion has been checked by hand in every WP since WP-04a; make it
     the linter's job.
   - Fix what the new rules flag. Split real offenders; an inline disable needs a sentence in the report.
3. **Audit unit-of-work — `apps/backend/src/platform/audit.ts`.** Extract WP-07a's hash-chain writer
   (R35) into `recordAudit(tx, entry)` and `withAudit(db, entry, fn)`, so a use case writes its change
   and its audit row in one transaction with one call, and refactor `modules/{auth,setup,users}` onto it.
   `verifyChain()` and its test survive unchanged. M1 adds merge, unmerge, override, category change and
   source edits — five more hand-rolled chain writers is how a chain gets broken.
4. **Settings: module-owned keys.** `settings.define(key, { schema, default, description })`, called at
   module load, with the central file reduced to the registry plus shared accessors. Test: every key
   defined exactly once, every key has a zod schema and a description, reading an unregistered key
   throws, and every WP-07b key still resolves to its existing value. WP-08b then registers the
   geography and event-type policies, WP-10 the dedup thresholds, WP-15b the ranking weights — without
   editing one shared file thirteen times.
5. **Golden fixtures — `apps/backend/src/testing/golden.ts`.** `expectGolden(name, value)` against
   `apps/backend/test/fixtures/<name>.golden.json`, stable key ordering, `UPDATE_GOLDEN=1` to rewrite,
   and a **missing golden file fails** rather than silently writing itself. Copy
   `docs/research/fixtures/{ctftime,devfolio}/**` into `apps/backend/test/fixtures/<source>/` — docs keep
   the research copy, the test tree gets the working copy — and add a test asserting the two copies are
   byte-identical, so a fixture edited in one place cannot drift from the other.
6. **Error-code domains (R12).** Extend `packages/contracts/src/errors.ts` with the `EVENT_`, `GEO_`,
   `SEARCH_` and `IMPORT_` blocks (`SOURCE_` exists), composed into the one closed enum. Test: every code
   matches `^[A-Z]+_[A-Z0-9_]+$`, carries a registered domain prefix, and is unique.
7. **M0 tech debt** (docs/handoff/M0.md §6):
   a) Remove `seed:dev` and its script — WP-07b's wizard replaced it. Whatever `smoke:bundle` still
      needed from it moves into the smoke test.
   b) `check-path`: report `INSIDE_DATA_DIR` **before** `MISSING`, so a non-existent folder inside the
      data directory gives the reason that actually helps. Test both orders.
   c) `smoke:bundle` cleanup uses the retrying remover from `src/testing/temp.ts` instead of a
      best-effort delete (Windows holds SQLite handles briefly after exit).
8. **Disk (R3).** Run `cargo clean` in `apps/desktop/src-tauri` — `target/` is 8 GB on a drive with 31 GB
   free and M1 barely touches Rust. Record free space before and after in the report and update
   PROGRESS.md's environment facts.

TESTS (all in `pnpm verify`, all with injected clocks — never a real sleep):
- time: a date-only IST deadline resolves to 18:30 UTC the previous day · `zonedDayBounds` is inclusive
  at both ends of the local day (A7) · an invalid IANA name throws instead of falling back to UTC · a
  fixed clock makes every helper deterministic · a round trip `toUtcInstant` → `formatDay` is stable.
- boundaries: temporarily add a forbidden import, capture the lint error, remove it — **paste the error
  into the report** (a rule nobody has seen fail is a rule nobody can trust).
- audit: two writes through `withAudit` chain correctly and `verifyChain()` accepts them; a forced
  failure inside the callback leaves neither the change nor the audit row.
- settings: duplicate `define` throws · unregistered read throws · WP-07b's keys keep their values.
- golden: a missing golden file fails without `UPDATE_GOLDEN` · a changed value fails with a readable
  diff · the docs and test-tree fixture copies are byte-identical.
- errors: prefix, format and uniqueness across the whole enum.
- tech debt: `check-path` precedence both ways; no manifest references `seed:dev`.

ACCEPTANCE: `pnpm verify` green · **test count ≥ 1736** (this WP adds tests and deletes none; say the new
number) · no source file over 400 lines · the boundary rules demonstrably fail on a violation (error text
in the report) · `pnpm audit:deps` clean · **no new runtime dependency** · the three Rust checks not
required (no `src-tauri` source change; `cargo clean` is not a source change) · the built exe still goes
wizard → sign-in → shell, verified by `smoke:bundle` plus one manual launch.

OUT OF SCOPE: everything in M1 (the events schema, adapters, search, UI — WP-08a onward owns all of it) ·
the appearance/theme work (WP-33) · moving shell preferences out of `shell-settings.json` (R28) · job
observability (R20, WP-30) · any new dependency · any behaviour change a user could see.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/pre-M1.md, commit
"pre-M1: consolidation before the events milestone", print the report). In the report: list every file
moved or renamed, give the before/after test count and free disk, and call out anything the new boundary
rules flagged that you judged to be a **real design problem rather than an import to fix** — this is the
last cheap moment to hear about it before thirteen WPs land on top.
