# pre-M1 — Consolidation before the events milestone

**Status:** DONE · 21 Sep 2026 · spec v1.1.6, no rulings issued · **no behaviour change**

Five things that were fine for one module and wrong for thirteen: time handling, layer boundaries,
audit writing, settings ownership and fixture comparison. Plus the M0 tech debt and `cargo clean`.
Eight commits, `pnpm verify` green after each.

## 1. What changed, in the order it was built

### 1.1 Time layer — `apps/backend/src/platform/time.ts`

`Clock` (`{ now(): Date }`) with `systemClock`, `fixedClock(iso)` and `advancingClock(iso, stepMs)`,
plus `nowMs(clock)` for the many callers that store an integer. Then the local-day arithmetic M1
needs: `APP_TIMEZONE`, `isValidTimeZone` / `assertTimeZone`, `offsetMinutesAt`, `toUtcInstant`,
`parseDay`, `zonedDayBounds`, `endOfDayIn`, `formatDay`. All through `Intl.DateTimeFormat` — **no new
dependency**. `DatePrecision` now lives in `packages/contracts/src/enums.ts` and is re-exported from
`time.ts`.

Every ad-hoc `now?: () => Date | number` became that `Clock`: `modules/**`, `jobs/**`,
`platform/{migrate,audit,settings,stream}.ts`, `app.ts`, `routes/health.ts`, and the two test clocks.

**Two things the tests turned up, both fixed:**

- `isValidTimeZone` now requires an `Area/Location` name (`UTC` excepted). ICU *accepts* bare
  abbreviations and resolves them to something plausible-looking: on this Node, `IST` →
  `Asia/Calcutta` (right by luck), but **`EST` → `America/Panama`**, a fixed −05:00 zone that never
  observes DST. A source saying "EST" would have had every summer deadline an hour late with nothing
  on screen looking wrong. Abbreviations are a normalization decision for the adapter (WP-09a), not a
  guess for this layer.
- A local time a spring-forward skipped used to resolve an hour **early** (02:30 → 01:30), which for a
  deadline is the direction that loses entries. It now resolves forward, to the transition instant,
  found by bisection on the gap only.

### 1.2 Layer boundaries — `apps/backend/src/domain/` + four ESLint rules

`domain/README.md` states the rule. Moved in: `domain/scheduling.ts` (jitter, backoff, `isDue`,
`isLeaseExpired`) and `domain/lockout.ts` (R34's ladder), with their tests. Both dropped their
`db/schema` import — the scheduling maths now declares the three fields it needs
(`JobSchedulingState`) and a Drizzle row satisfies it structurally, so no call site changed.

Rules added to `eslint.config.js`, **no new plugin** (core `no-restricted-imports` + `max-lines`):

| Scope | Rule |
|---|---|
| `apps/backend/src/domain/**` | no `drizzle-orm`, `better-sqlite3`, `fastify`, `@fastify/*`, `pino`, `node:fs`, `node:path`, `**/db/**` |
| `apps/backend/src/routes/**` | no `**/db/**` — go through a service |
| `packages/contracts/src/**` | no `**/apps/**` |
| `apps/*/src/**`, `packages/*/src/**` | `max-lines: 400`, tests and `src/testing/**` exempt |

They were verified to fail on a violation (§3 below) and one of them immediately caught a real file.

### 1.3 Audit unit of work — `platform/audit.ts`

`recordAudit(tx, entry)` and `withAudit(db, entry, work)`. `withAudit` runs the change and its audit
row in one transaction: if `work` throws there is no audit row, and if the audit write throws the
change goes back with it. `entry` may be a function of `work`'s result, for an id that does not exist
until after the insert. `work` must be synchronous — better-sqlite3 transactions are — so hashing
happens before the call, which is why `changePassword`, `users.create` and `users.resetPassword` now
hash first and write second.

Eleven hand-rolled append-after-write pairs in `modules/{auth,setup,users}` moved onto it, including
the login-failure path, where the counter, the lock it may trigger and the row explaining it now go
in together. `verifyChain()` and its test are untouched.

### 1.4 Settings — module-owned keys

`define(key, { schema, default, description })` returns a **typed handle**, and the handle is the only
way to read or write. A typo is still a compile error, and because a module must import the handle to
use the setting, the definition is always registered before the first read — no import-order hazard
of the kind a registry of bare strings would have. `serialize(definition, value)` lets the wizard
write its batch inside R40's one transaction and still be validated by the same schema a later read
uses.

Definitions moved to `modules/{auth,backup,org}/settings.ts`; `apps/backend/src/settings.ts` is the
barrel for anything enumerating the whole registry. WP-08b's geography and event-type policies,
WP-10's dedup thresholds and WP-15b's ranking weights each land in their own file.

### 1.5 Golden fixtures — `testing/golden.ts`

`expectGolden(name, value)` against `apps/backend/test/fixtures/<name>.golden.json`, keys sorted at
every depth, `UPDATE_GOLDEN=1` to record. **A missing golden fails** and says how to record it: a
helper that writes the file it could not find always passes on the first run, which is how a bug
becomes the expected output.

WP-02's ctftime and devfolio fixtures have a working copy in the test tree; `docs/research/` keeps the
evidence copy. A test asserts the two are byte-identical, and `.prettierignore` keeps Prettier out of
`apps/backend/test/fixtures` for the same reason.

### 1.6 Error-code domains (R12)

`EVENT_` (7), `GEO_` (4), `SEARCH_` (4) and `IMPORT_` (5) blocks added, plus five more `SOURCE_` codes
for the compliance gate and §7.7's failure taxonomy. `ERROR_CODE_DOMAINS` names the domains. Tests:
every non-common code carries a registered prefix and a `DOMAIN_NAME` shape, the whole enum is
SCREAMING_SNAKE and unique, no domain is declared that nothing uses, and every code still builds a
valid problem-type URN.

### 1.7 M0 tech debt

- **`seed:dev` gone**, script and `tools/seed-dev-user.ts`. `smoke:bundle` needed nothing from it (it
  drives the wizard). `scripts.test.ts` keeps it gone — a second, unaudited way to mint an account
  with a password printed to a terminal is not worth keeping.
- **`check-path`** decides `INSIDE_DATA_DIR` before it looks for the folder. Both reasons are true of a
  missing folder inside the data directory and only one ends the conversation: told `MISSING`, a user
  creates it and is refused again. Both orders tested.
- **`removeDirectory(dir, timeoutMs)`** in `testing/temp.ts` retries to a deadline while Windows lets
  go of the SQLite and addon handles, and returns whether the directory is gone. `smoke:bundle` uses
  it and says so if a staged copy survives, instead of silently leaking one per run.

### 1.8 Disk (R3)

`cargo clean` in `apps/desktop/src-tauri`: **11 443 files, 11.2 GiB removed**. Free space on C:
**28.8 GB → 38.2 GB**. (`target/` had grown to 11.2 GB, well past the 8.0 GB PROGRESS.md recorded.)

The acceptance check below needed the exe, so `target/` was rebuilt from empty — **1 m 57 s**, and a
debug `target/` is **3.66 GB**. It was left in place rather than cleaned again: C: is at **34.9 GB**
free, which is comfortable, and the desktop WPs in M1 would only pay the rebuild back. R3's threshold
is 20 GB.

## 2. Files moved, renamed or deleted

| From | To |
|---|---|
| `jobs/schedule.ts` (`applyJitter`, `backoffDelayMs`, `isDue`, `isLeaseExpired`) | `domain/scheduling.ts` |
| `jobs/schedule.test.ts` (those four describes) | `domain/scheduling.test.ts` |
| `modules/auth/throttle.ts` (`LOCKOUT_*`, `lockoutMinutesFor`) | `domain/lockout.ts` |
| `modules/auth/throttle.test.ts` (the ladder describe) | `domain/lockout.test.ts` |
| `modules/auth/service.ts` (`Principal`, `ActiveSession`, `LoginContext`, `LoginResult`) | `modules/auth/types.ts` |
| `modules/auth/service.ts` (`#failureEntry`) | `modules/auth/audit-entries.ts` |
| `platform/settings.ts` (the `definitions` object) | `modules/{auth,backup,org}/settings.ts` |
| `docs/research/fixtures/{ctftime,devfolio}/**` | *copied* to `apps/backend/test/fixtures/<source>/` |

**New:** `platform/time.ts` · `domain/{README.md,scheduling.ts,lockout.ts}` · `settings.ts` (barrel) ·
`testing/golden.ts` · `testing/temp.test.ts`.
**Deleted:** `tools/seed-dev-user.ts` and the `seed:dev` script.

## 3. The boundary rules, failing

Forbidden imports were added temporarily, the error captured, and removed:

```text
apps\backend\src\domain\lockout.ts
  1:1  error  'drizzle-orm' import is restricted from being used by a pattern. src/domain is pure logic:
              no I/O and no framework (§3.3). Take the data as an argument and let a service or
              repository fetch it                                              no-restricted-imports
  2:1  error  '../db/schema/index.js' import is restricted from being used by a pattern. src/domain may
              not know how anything is stored (§3.3). Describe the shape it needs in the domain file; a
              Drizzle row satisfies it structurally                            no-restricted-imports

apps\backend\src\routes\health.ts
  1:1  error  '../db/schema/index.js' import is restricted from being used by a pattern. A route goes
              through a service, never straight to the database (§3.3), so authorization and the audit
              entry cannot be skipped                                          no-restricted-imports

packages\contracts\src\version.ts
  1:1  error  '../../../apps/backend/src/app.js' import is restricted from being used by a pattern.
              packages/contracts is imported by every app and must not depend on one (§3.4)
                                                                               no-restricted-imports

apps\backend\src\domain\lockout.ts
  401:1  error  File has too many lines (448). Maximum allowed is 400                       max-lines
```

`max-lines` also fired for real, on `modules/auth/service.ts` at 428 after the audit refactor — see
§1.2 and §2 for the split. It is 380 now.

## 4. The one thing worth arguing about

**`jobs/schedule.ts` did not move, and the reason is a design problem, not an import.**

`firstDueAt` and `nextDueAfterRun` stayed in `jobs/`. They need a `RegisteredJob`, and
`JobDefinition.nextDueAt` is typed `(from: Date, previous: JobStateRow) => number` — the Drizzle row,
by name. Moving them means the job-state shape being **defined in `domain/` and `db/schema`
conforming to it**, which is the right direction and a real jobs-layer refactor. `firstDueAt` also
synthesizes a whole zeroed `JobStateRow` to hand to that callback, which is the shape of a type that
is doing two jobs.

It is small — maybe an hour — but it is not free, it touches the scheduler's public surface, and
WP-30 already owns job observability. Flagging rather than doing it, per the prompt's instruction to
say what is a design problem rather than an import to fix.

## 5. Numbers

| | Before | After |
|---|---|---|
| Tests | 1736 (1429 node + 307 desktop) | **1790** |
| Test files | 70 | 74 |
| `pnpm verify` | green | green (~60 s) |
| `pnpm audit:deps` | clean | clean |
| Largest source file | 385 (`jobs/scheduler.ts`) | 386 (`jobs/scheduler.ts`) |
| C: free | 28.8 GB | 38.2 GB after `cargo clean`; **34.9 GB** with the debug `target/` rebuilt |
| New dependencies | — | **none** |

## 6. Acceptance evidence

- **`pnpm verify`** green: Prettier clean, ESLint clean, `tsc -b` clean, **1790 tests in 74 files**.
- **`pnpm audit:deps`**: no known vulnerabilities.
- **No new dependency** — `package.json` gained nothing and lost `seed:dev`.
- **No source file over 400 lines** (the linter now says so, not a person).
- **`smoke:bundle` PASSED** end to end on a fresh data directory: READY parsed, `/health` 200 with
  `migrationsApplied=4`, `/auth/login` 409 `SETUP_REQUIRED`, check-path 200, `/setup/complete` 200,
  admin login 200 (the Argon2id addon loaded from `native\`), second complete 409, and both runs exited
  0 on stdin EOF.
- **Built exe** (`tauri build --debug --no-bundle`, rebuilt from an empty `target/`), driven over the
  WebView2 DevTools protocol:
  - fresh `COMPINTEL_DATA_DIR` → **the wizard**: "Welcome to CompIntel", step 1 "Your institution",
    "Get started"; the data directory was created with `data/`, `logs/`, `backups-local/`, `backend.lock`.
  - the existing dev data directory → **sign-in**: "Sign in to CompIntel". A second launch skips the
    wizard, as WP-07b recorded.
  - signing in as the administrator → **the shell**: "Dashboard", with the full permission-filtered rail
    (Dashboard · Discover · Competitions · Teams · Students · Assistant · Notifications, then the admin
    section: Users · Sources & scraper · Categories & rules · Duplicates · Campus & settings · Backups ·
    Audit log · System health).
  - To sign in I set a known password on `admin@compintel.local` **in the dev data directory only**, with
    a throwaway script kept in the scratchpad, not the repo — the same approach WP-07b used, and the
    reason `seed:dev` is not needed in the tree. That dev account's password is now
    `pre-M1-manual-check-2026`; it is synthetic data in `%LOCALAPPDATA%\CompIntel-dev` (D-33).
  - The throwaway `manual-check` data directory was removed afterwards.
- **Rust checks not run** and not required: no `src-tauri` source changed (`cargo clean` and a rebuild
  are not source changes).

## 7. For the next WP

- Read `apps/backend/src/domain/README.md` before putting anything in `domain/`; the linter is not
  negotiable and the error text tells you what to do instead.
- A new setting is `define()` in your own module's `settings.ts`, plus one line in
  `apps/backend/src/settings.ts`. Never a string.
- A mutating use case is `withAudit(this.#audit, entry, () => …)`. Hash, fetch and await **before** the
  call; the callback is synchronous.
- Dates go through `platform/time.js`. `zonedDayBounds` is half-open, `endOfDayIn` is what a date-only
  deadline means, and an IANA name that is not `Area/Location` is rejected — WP-09a will need to map
  the abbreviations sources actually send.
- Goldens: `expectGolden('ctftime/normalized-listing', value)`, then `UPDATE_GOLDEN=1 pnpm test` once,
  and review the recorded file in the same commit.
