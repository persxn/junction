=== WORKER REPORT: WP-04b ===
Status: DONE

Summary (≤5 lines):
Recorded rulings R11–R18 (spec v1.1.2, docs-only commit), then applied the WP-04a review fixes
(request logging, per-domain error codes, `instance` without query, shutdown phases, stdin lifeline
before listen) and built the data layer: UUIDv7, the data-dir lock, better-sqlite3 + Drizzle with the
R16 PRAGMAs and `quick_check`, and a migration runner with the `VACUUM INTO` pre-migration copy.
pnpm verify green (340 tests), smoke:bundle passes from a node_modules-free folder, audit clean.

Files changed (paths only):
docs/ARCHITECTURE.md · docs/PROGRESS.md · docs/handoff/WP-04b.md
.prettierignore · eslint.config.js · pnpm-workspace.yaml · pnpm-lock.yaml
packages/contracts/src/{errors.ts,errors.test.ts,ids.ts,ids.test.ts,system.ts,system.test.ts,
  index.ts,version.test.ts}
apps/backend/{package.json,drizzle.config.ts}
apps/backend/migrations/{0000_pretty_sphinx.sql,meta/_journal.json,meta/0000_snapshot.json}
apps/backend/src/db/schema/{app-meta.ts,index.ts}
apps/backend/src/{app.ts,main.ts,main.test.ts,index.ts}
apps/backend/src/platform/{db.ts,db.test.ts,ids.ts,ids.test.ts,lifecycle.ts,lifecycle.test.ts,
  lock.ts,lock.test.ts,migrate.ts,migrate.test.ts,request-log.ts,request-log.test.ts,
  resources.ts,resources.test.ts,scripts.test.ts,config.ts,errors.ts,shutdown.ts,shutdown.test.ts}
apps/backend/src/routes/{health.ts,routes.test.ts}
apps/backend/src/testing/{harness.ts,temp.ts}
apps/backend/src/tools/{bundle.ts,smoke-bundle.ts}

Tests/commands & results:
- `pnpm verify` → format:check, eslint, tsc -b, vitest: **21 files, 340 tests passed, 19 s**.
- `pnpm --filter @compintel/backend smoke:bundle` → **PASSED**:
    ok  staged the bundle in C:\Users\Calamity\AppData\Local\CompIntel-dev\bundle-smoke with no node_modules above it
    ok  READY parsed: {"ready":true,"port":60911,"pid":13160,"appVersion":"0.1.0","apiVersion":"1.0.0"}
    ok  /health 200: database.ok=true migrationsApplied=1
    ok  new database: no pre-migration copy
    ok  first run: stdin EOF -> exit 0
    ok  second run: applied nothing, made no copy
    ok  second run: stdin EOF -> exit 0, stdout carried only the READY line
- `pnpm audit:deps` → **No known vulnerabilities found** (after the override below).
- `npx drizzle-kit generate` re-run after the override: "No schema changes, nothing to migrate".
- Coverage of the required list: ids (format, version/variant, 10k in one ms, counter overflow, clock
  going backwards); migrate (empty DB, idempotent re-run, copy on a non-empty DB that itself opens and
  passes quick_check, retention of 5, failing migration → rollback + MIGRATION_FAILED + copy kept,
  missing journal); custom SQL (FTS5 `tokenize='trigram'` + trigger asserted via sqlite_master, MATCH
  on a substring hits, a non-substring misses); db (all six PRAGMAs read back, injected quick_check
  failure → DB_CORRUPT, DB_OPEN_FAILED, checkpoint + close, app.db self-contained after close); lock
  (live pid → DATA_DIR_LOCKED, dead/unparsable pid → take over, release only while ours); WP-04a fixes
  (one log line with method/route/status/ms/requestId, `/health` at debug, `instance` has no query,
  streams→close→resources order, failing hook → exit 1, stdin already ended → clean shutdown);
  plus process-level tests: second backend on the same data dir → DATA_DIR_LOCKED + exit 1, restart
  makes no copy, corrupt app.db → ready:false + exit 1.

Deviations from the prompt (why):
1. The lifecycle moved out of `main.ts` into `platform/lifecycle.ts`. `main.ts` runs on import, so a
   test could not import it; the new module takes `exit`, `stdin` and `attachSignals` as seams, which
   is how the R14 ordering and the already-ended-stdin case are tested at all.
2. `buildApp` now accepts the `ShutdownRegistry`, because the lock and the database are opened before
   the HTTP layer and must register their teardown.
3. `db:generate:custom` is `drizzle-kit generate --custom`; the name is passed by the caller
   (`pnpm db:generate:custom -- --name=add_event_fts`) rather than baked into the script.
4. `openDatabase` also maps a non-StartupError thrown by the first PRAGMA to `DB_OPEN_FAILED`:
   better-sqlite3 opens lazily, so "file is not a database" surfaces there, not in the constructor.
5. The DB_ error codes added to the contract are `DB_UNAVAILABLE` and `DB_CONSTRAINT_VIOLATED`. They
   are the vocabulary for R12; nothing raises them yet (the database is proven at startup, so a
   request-time DB failure only becomes reachable with the repositories in WP-04c onward).

Minor decisions made:
- UUIDv7 keeps its own high-water millisecond, so a backwards clock never yields a smaller id; counter
  overflow borrows a millisecond from the future. 4096 ids fit in one millisecond.
- `backend.lock` holds `{pid, startedAt}`; liveness is `process.kill(pid, 0)` with `EPERM` counted as
  alive. Pid reuse is accepted, as R15 allows. Released in the `resources` phase and on `process.exit`.
- Pending migrations are detected the way Drizzle itself decides: journal entries whose `when` is
  newer than `max(created_at)` in `__drizzle_migrations`.
- Pre-migration copies are named `pre-migration-<yyyyMMdd-HHmmss>.db` in host-local time (A15) with a
  `-1`, `-2` suffix if the same second repeats; pruning runs on every copy and ignores foreign names.
- `%LOCALAPPDATA%\CompIntel-dev\test-tmp` is the root for every test data directory (`testing/temp.ts`),
  with a retrying, error-swallowing cleanup: Windows keeps a SQLite handle open briefly after close and
  `rmSync` in the system temp folder failed with EPERM.
- `logController: new LogController({ disableRequestLogging: true })` instead of the top-level option,
  which Fastify 5.12 deprecates (FSTDEP023).
- `QUIET_ROUTES` in `request-log.ts` is the one place a route is demoted to debug; only
  `GET /api/v1/health` is in it.
- `apps/backend/migrations/` is excluded from Prettier so regenerating never fights `format:check`;
  `drizzle.config.ts` is added to ESLint's `allowDefaultProject`.
- Backend `version.ts` / package version stay at 0.1.0.

New dependencies (name@version — why):
- better-sqlite3@13.0.3 — the database driver from §4.5 / ADR-0005; the exact version probed in WP-03a.
  Needs `allowBuilds: { better-sqlite3: true }` for its install script. Note: on this machine the
  install **compiled from source via node-gyp (~16 s)** rather than using a prebuild, unlike WP-03a's
  4 s prebuild-only install; the VS Build Tools from WP-03a made that invisible, but a machine without
  them would fail. `prebuilds/win32-x64.node` is present either way and is what the bundle copies.
- drizzle-orm@0.45.2 — the ORM and migrator from §4.6 / ADR-0005; pinned exactly (it is still 0.x).
- drizzle-kit@0.31.10 (dev) — generates the reviewed SQL migrations. `generate` only, never `push`.
- @types/better-sqlite3@9.6.0 (dev) — better-sqlite3 ships no types of its own.
- pnpm override `@esbuild-kit/core-utils>esbuild: 0.28.2` — drizzle-kit still drags in the deprecated
  `@esbuild-kit/*` packages pinning esbuild 0.18 (GHSA-67mh-4wv8-2f99, dev-server request forgery).
  Nothing runs that dev server, but `audit:deps` (R4) must stay clean. `drizzle-kit generate` re-verified.

Known issues / tech debt:
- `pnpm-workspace.yaml` still carries pnpm's auto-added `minimumReleaseAgeExclude: tsx@4.23.15` and two
  deprecation warnings for `@esbuild-kit/*` (drizzle-kit's problem, not ours).
- The bundle is 2.4 MB + a 4.1 MB source map, plus the 2.8 MB addon in `native\`. Argon2 joins it in
  WP-07a; the packaged layout (A20) expects both under `resources\backend\native`.
- `db.ts` logs the full pragma set at info on every start. Harmless, but it is one more line per launch.
- Windows file-handle timing means `removeTempDir` swallows failures; a leaked `test-tmp` subfolder is
  possible after a crashed run. It is under `%LOCALAPPDATA%\CompIntel-dev`, never in the repo.

Questions for the architect:
1. R12 asks for domain-prefixed codes. `SOURCE_UNREACHABLE` predates the ruling and is unprefixed in
   spirit (`SOURCE_` is the domain, so it happens to fit). Confirm that reading, or rename it.
2. Should `app_meta` also record the migration tag last applied, so "Copy diagnostics" can report the
   schema level without opening `__drizzle_migrations`?
3. The pre-migration copy is taken while the database is open in WAL mode. `VACUUM INTO` is
   transactionally safe, but it copies committed state only — confirm that is the intent for F4.

Files the architect should review (≤5, most important first):
1. apps/backend/src/platform/migrate.ts — pending detection, the copy, retention, failure semantics.
2. apps/backend/src/platform/db.ts — PRAGMAs, quick_check, checkpoint/close.
3. apps/backend/src/platform/lifecycle.ts — the R14 phase order and exit codes.
4. apps/backend/src/platform/lock.ts — R15, including the stale-takeover rule.
5. apps/backend/src/platform/ids.ts — UUIDv7 monotonicity and clock-regression handling.

Suggested next step:
WP-04c (DB-backed job runner). `job_state` is the next migration; the `resources` shutdown phase and
the lock are already in place for it.
===
