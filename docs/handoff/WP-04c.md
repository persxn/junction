=== WORKER REPORT: WP-04c ===
Status: DONE

Summary (≤5 lines):
The DB-backed job runner from §4.9 / ADR-0008 is in: migration 0001 creates `job_state`, and
`apps/backend/src/jobs/` holds the tick, the single-flight lease, catch-up, jitter, the exponential
backoff ladder, stale-lease recovery, the per-class concurrency limits, the offline skip and a manual
trigger. It is constructed and started in `main.ts` with **no jobs registered**: each later WP registers
its own. `pnpm verify` is green (422 tests), `smoke:bundle` and `audit:deps` pass, no new dependencies.

Files changed (paths only):
- packages/contracts/src/jobs.ts (new), packages/contracts/src/index.ts
- apps/backend/src/db/schema/job-state.ts (new), apps/backend/src/db/schema/index.ts
- apps/backend/migrations/0001_sad_boomer.sql, migrations/meta/0001_snapshot.json, migrations/meta/_journal.json
- apps/backend/src/jobs/{types,schedule,outcome,store,run,scheduler,online,index}.ts (new)
- apps/backend/src/jobs/{schedule,outcome,store,scheduler,scheduler-control}.test.ts (new)
- apps/backend/src/testing/{database,scheduler}.ts (new)
- apps/backend/src/main.ts, apps/backend/src/index.ts, apps/backend/src/main.test.ts
- docs/PROGRESS.md

Tests/commands & results:
- `pnpm verify` → format:check, lint, typecheck, **422 tests green (21 s)**; 115 of them are new.
  The four acceptance tests named in §19 are `scheduler.test.ts`: catch-up after "sleep" (8 h gap runs
  the job once and reschedules from the run, not from the missed slot), single-flight (in memory *and*
  via the conditional-UPDATE claim), stale lock (startup reclaim + runtime lease expiry → `CRASHED`),
  backoff (15 → 30 min ladder, silent in between, streak cleared by a success).
- `pnpm --filter @compintel/backend smoke:bundle` → PASSED; the bundle now reports
  `migrationsApplied=2` and still exits 0 on stdin EOF with only the READY line on stdout.
- `pnpm audit:deps` → no known vulnerabilities.
- One `ECONNRESET` flake appeared in a child-process HTTP test on a single run and did not reproduce in
  four consecutive full runs (see Known issues).

Deviations from the prompt (why):
- None in scope. The WP is the runner only; the jobs §4.9 lists (`scrape:<source>`, `detail-refresh`,
  `deadline-evaluator`, `saved-search-evaluator`, `backup:daily`, `cleanup`, `health-snapshot`) each need
  a subsystem that does not exist yet (sources, deadlines, backups, diagnostics), so none is registered.
  `main.ts` starts an empty scheduler; the registration seam is `scheduler.register(definition)`.
- The architect is offline, so the questions below are recorded rather than answered, and every choice
  that could have been a ruling is listed under Minor decisions instead of being made silently.

Minor decisions made:
1. **`job_state` columns beyond §6.2.** Added `kind`, `last_outcome`, `last_duration_ms`,
   `last_error_message`. Without them "why is this job red?" needs a per-run history table, and
   `scrape_runs` (WP-11) only covers scraping. CHECK constraints are generated from the contracts enums,
   and there is an index on `next_due_at` (the only column the tick filters on).
2. **Two runner-only outcomes.** `ABORTED` (shutdown cut the run short) and `CRASHED` (a lease was found
   stale) join the five that match `scrape_runs.outcome`. `ABORTED` is not a failure and leaves
   `next_due_at` untouched, so the work is still due at the next start. `CRASHED` **is** counted as a
   failure: otherwise a job that kills the backend would re-run immediately on every restart and the
   shell's restart backoff would be the only brake.
3. **`PARTIAL` sets `last_run_at` but not `last_success_at`** and clears the failure streak, per §7.6
   ("partial runs never mark MISSING") — a partial scrape is not proof the source is healthy.
4. **Backoff defaults are the §7.2 source ladder** (15 min base, 12 h cap, ±10 % jitter) for every job
   class, overridable per job. §4.9 asks for backoff without numbers, and inventing a second ladder for
   local jobs seemed worse than reusing the one the spec already fixes.
5. **`GENERAL` concurrency limit = 4.** §4.9 fixes only 2 scrapes and 1 LLM job. Unlimited would let a
   future burst of local jobs monopolise the single-writer database.
6. **Concurrency deferral records nothing.** A job held back by a limit keeps its row untouched and is
   retried next tick, rather than getting a `SKIPPED_*` row; only the tick summary and the debug log
   mention it. `SKIPPED_BACKOFF` exists in the enum for a refused manual run.
7. **Offline detection reads the interface table** (`os.networkInterfaces()`, ignoring internal and
   link-local addresses) and makes no network call. A real reachability probe belongs to the polite HTTP
   client (WP-11); the check here only exists so a laptop on a train does not build a failure streak.
8. **Stale-lease policy.** Any lease present at startup is reclaimed unconditionally (R15 proves the
   holder is dead). At runtime a lease is reclaimed only if it is older than the job's `leaseMs`
   (default 15 min) **and** this process has no in-flight run for it.
9. **Jitter is applied to intervals and to backoff**, ±10 %, never below 1 ms, so a jittered delay can
   never resolve to "due again immediately".
10. **`tick()` is public and returns once runs are started.** Tests move an injected clock and call
    `tick()` + `drain()`, so nothing in the suite waits on a real 30-second timer. The interval timer is
    `unref()`ed: a pending tick must never hold the process open.
11. **No API surface.** Observability is the one `job finished` log line per run plus
    `scheduler.snapshot()` (validated against the `JobSnapshot` contract). No route was added — see Q1.
12. **`scheduler.ts` split at 380 lines** and the scheduler suite split in two, to stay under the
    400-line rule; `run.ts` holds the one-run wrapper, `schedule.ts`/`outcome.ts` the pure math.
13. **`main.test.ts` no longer hardcodes `migrationsApplied: 1`**; it reads the journal, so the
    assertion survives every future migration.

New dependencies (name@version — why):
- None.

Known issues / tech debt:
- `drizzle-kit generate` resolves `@compintel/contracts` to the package's built `dist`, so a schema file
  that imports the enums needs `pnpm typecheck` (or a build) first, or the CHECK helpers read
  `undefined`. Recorded in PROGRESS.md "Standard commands"; a `db:generate` that depends on the build
  would be the real fix.
- One `ECONNRESET` in a child-process HTTP test, once, not reproducible in four further runs. Windows has
  no graceful signal, so a test that fetches while a previous child is being hard-killed can see a reset
  socket. Worth watching; if it returns, the fix is to await child exit in `afterEach`.
- A job that ignores its `AbortSignal` is abandoned after the 5 s drain and its lease is left behind on
  purpose, to be reclaimed as `CRASHED` on the next start. Correct, but it means a hung job delays
  shutdown by 5 s of the 10 s budget.
- `scheduler.snapshot()` reads every row on each call. Fine for a handful of jobs; it is not a query for
  an admin screen that polls.

Questions for the architect:
1. **Observability surface.** Should `job_state` be exposed as `GET /api/v1/system/jobs` (and a
   `scheduler` section on `/health`), or does that wait for the admin diagnostics WP? `JobSnapshot` is
   already in contracts for whichever answer.
2. **`CRASHED` counted as a failure** (decision 2) means a backend killed during a scrape leaves that
   source backing off for 15 minutes after the restart. Correct, or should a reclaimed lease be a free
   retry with, say, a shorter fixed delay?
3. **Per-job persistence of the concurrency class.** `kind` follows the code on every start
   (decision 1). Confirm that is right, or should a class change be a migration?
4. **`health-snapshot` (hourly) and `cleanup` (daily)** have no owning WP in the §19 roadmap. Should
   WP-04c have shipped them, or do they belong with WP-28/WP-30 diagnostics?
5. **Offline check** (decision 7): confirm that an interface-table check is enough for MVP, and that a
   reachability probe (e.g. a HEAD to the source's own host, honouring its crawl-delay) is WP-11's.

Files the architect should review (≤5, most important first):
1. apps/backend/src/jobs/scheduler.ts — the tick, claims, limits, reclaim and stop paths.
2. apps/backend/src/jobs/outcome.ts — the state machine: what each outcome does to the row.
3. apps/backend/src/db/schema/job-state.ts — the table, including the columns beyond §6.2.
4. apps/backend/src/jobs/schedule.ts — jitter, the backoff ladder, due and lease predicates.
5. packages/contracts/src/jobs.ts — the enums the database CHECKs and the logs both use.

Suggested next step:
WP-05a (Tauri shell: spawn via `Command`, Job Object, READY handshake, `backend_connection()`,
restart/backoff, "Exit completely"). The backend side it needs is done: the READY line, the stdin
lifeline, the data-dir lock and now a scheduler that stops cleanly in the `resources` phase.
===
