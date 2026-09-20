=== WORKER REPORT: WP-04a ===
Status: DONE

Summary (≤5 lines):
Recorded rulings R1–R10 in ARCHITECTURE.md §21 and bumped the spec to v1.1.1 (docs-only commit).
Built the backend app factory in apps/backend: zod config, pino + in-house daily rotation with deep
redaction, RFC 9457 problem+json with X-Request-Id, Host/client-secret/CORS hardening, /health and
/system/shutdown under /api/v1, buildApp() without listen, and main.ts with the READY line, stdin-EOF
lifeline and a 10 s graceful shutdown. pnpm verify green (217 tests), smoke:bundle and audit:deps pass.

Files changed (paths only):
docs/ARCHITECTURE.md · docs/PROGRESS.md · docs/handoff/WP-04a.md
.gitignore · .prettierignore · eslint.config.js · package.json · pnpm-workspace.yaml ·
pnpm-lock.yaml · vitest.config.ts
packages/contracts/src/{errors.ts,errors.test.ts,system.ts,system.test.ts,index.ts,version.test.ts}
apps/backend/package.json
apps/backend/src/{app.ts,main.ts,main.test.ts,index.ts}
apps/backend/src/platform/{config.ts,config.test.ts,errors.ts,errors.test.ts,logger.ts,logger.test.ts,
  redact.ts,rotating-file.ts,security.ts,security.test.ts,shutdown.ts,shutdown.test.ts,
  startup-error.ts,version.ts,version.test.ts}
apps/backend/src/routes/{health.ts,system.ts,routes.test.ts}
apps/backend/src/testing/{harness.ts,backend-process.ts}
apps/backend/src/tools/{bundle.ts,smoke-bundle.ts}
(deleted) apps/backend/src/index.test.ts

Tests/commands & results:
- `pnpm verify` → format:check, eslint, tsc -b, vitest: **12 files, 217 tests passed, 7.2 s**.
- `pnpm --filter @compintel/backend smoke:bundle` → bundle 2.2 MB `dist-bundle/main.mjs` (195 ms), then:
  READY parsed; /health 200 (appVersion 0.1.0, apiVersion 1.0.0); /health without the secret 401;
  stdin EOF → exit 0; stdout carried only the READY line. **smoke:bundle PASSED.**
- `pnpm audit:deps` (`pnpm audit --audit-level=moderate`, network) → **No known vulnerabilities found.**
- Manual probe against a live process confirmed 200/401/403/404, a 204 preflight with CORS headers for
  http://tauri.localhost, 401 for a preflight from a foreign origin, and 202 + exit 0 for /system/shutdown.
- Coverage of the required test list: config precedence + validation + unusable data dir; AppError,
  schema validation with errors[], 404, unknown throw with no leak, problem+json content type,
  X-Request-Id in header and body; 401 missing/wrong secret, 403 bad Host, 204 allowlisted preflight
  without the secret, no CORS headers for a foreign origin; redaction never reaching the log file,
  rotation and 14-file retention under a fake clock; and six process tests spawning src/main.ts via tsx.

Deviations from the prompt (why):
1. `buildApp(config, logger)` is synchronous and does not call `server.ready()`. Awaiting `register()`
   boots Fastify, which would seal the instance and stop tests adding fixture routes. `listen()` and
   `inject()` still boot it. The signature and "no listen, for tests" intent are unchanged.
2. `<dataDir>\dev-connection.json` is written by `main.ts` after `listen()`, not by `loadConfig()`:
   `baseUrl` needs the port, which `--port 0` only settles at listen time. `config.ts` still owns the
   generation and the writer, and refuses to write outside `--dev`.
3. The client secret has **no CLI flag**, environment only, because a command line is readable by every
   other process. `--client-secret` is rejected as an unknown flag (there is a test).
4. `esbuild@0.28.2` needed an entry in pnpm-workspace `allowBuilds` (WP-03b had `onlyBuiltDependencies: []`);
   pnpm 12.4.2 wrote the newer `allowBuilds` key itself, so that block replaced the old empty list.
5. The SIGINT/SIGTERM/SIGBREAK handlers are installed but cannot be tested across processes: Windows has
   no POSIX signals, so `child.kill('SIGTERM')` calls TerminateProcess. The test asserts the process dies;
   the real lifeline (stdin EOF) and the API path are tested properly.

Minor decisions made:
- `ReadyLine` failure codes are a new closed enum `StartupErrorCode` = CONFIG_INVALID, DATA_DIR_UNUSABLE,
  LISTEN_FAILED, STARTUP_FAILED, so the shell can switch on them.
- `ProblemDetails.errors[].path` is a dotted string (`body.name`, `query.limit`), not an array.
- Redaction is a deep walk in pino's `formatters.log` (key regex: password/passwd/passphrase, secret,
  token, api[-_]key, authorization, e?mail, phone, mobile, x-compintel-client) rather than pino `redact`
  paths, which cannot express "any such key at any depth". Depth cap 8, cycle-safe, non-mutating.
- The rotating destination writes **synchronously** (`fs.writeSync`): at this log volume the cost is
  irrelevant and `process.exit` can never drop a buffered line.
- Log files are `backend-YYYY-MM-DD.log` in host-local time (A15); retention prunes on every rotation,
  including files left by an earlier run, and ignores non-matching names.
- The Host allowlist is derived from the **actually bound port** (`server.address()`), so `--port 0` works.
- Fastify's own 4xx (bad JSON, 413 body limit) are surfaced as `VALIDATION_FAILED` rather than `INTERNAL`.
- `tsx` pinned to **4.23.13**, not 4.23.15: pnpm's release-age gate flagged 4.23.15 as published hours ago.
- `APP_VERSION` is a constant in `platform/version.ts` (bundle-safe) with a test asserting it matches
  `package.json`; the backend version moved 0.0.0 → 0.1.0.
- Build tooling lives in `src/tools/*.ts` so it is type-checked and linted like the rest; it is excluded
  from coverage, and esbuild bundles only what `main.ts` imports.
- Root vitest `testTimeout`/`hookTimeout` raised to 20 s for the process tests; `dist-bundle/` is
  gitignored and excluded from ESLint and Prettier.

New dependencies (name@version — why):
- fastify@5.12.5 — the HTTP server chosen in §4.3.
- @fastify/cors@11.3.0 — the CORS allowlist required by ADR-0017/A3 and ruling R9.
- fastify-type-provider-zod@7.0.0 — zod 4 + Fastify 5 route schemas (§4.4). Its `@fastify/swagger` and
  `openapi-types` peers are left uninstalled on purpose: OpenAPI generation is out of scope and pnpm
  installs cleanly without them.
- pino@10.3.1 — the logger named in §4.14.
- zod@4.6.5 (already in contracts) — direct dependency for config and route schemas.
- tsx@4.23.13 (dev) — runs the TypeScript entry point for `dev`, `start` and the process tests.
- esbuild@0.28.2 (dev) — the `bundle` script; needs `allowBuilds: { esbuild: true }` for its postinstall,
  which moves the `@esbuild/win32-x64` binary into place.

Known issues / tech debt:
- Fastify's default request logging is on, so the shell's `/health` poll writes two lines per poll
  (~2 MB/day at a 10 s interval). Worth a sampling rule or a route-level opt-out once WP-05a fixes the
  poll interval.
- `dist-bundle/main.mjs` is 2.2 MB with a 3.5 MB source map; no native modules are in it yet
  (better-sqlite3 and argon2 arrive in WP-04b and ship as `resources\backend\native`, per A20).
- `pnpm-workspace.yaml` carries a `minimumReleaseAgeExclude: tsx@4.23.15` entry that pnpm added itself:
  vite resolves tsx as an optional peer independently of our pinned 4.23.13. Harmless, but noise.
- The 10 s shutdown timeout is not covered by a test; with an empty hook registry there is nothing slow
  to await. WP-04b should add one once the DB hook exists.

Questions for the architect:
1. Request logging: keep every request at info, sample it, or exclude `/health`? (Affects §4.14 volume.)
2. `problemType()` produces `urn:compintel:problem:<code>` from the eight `ErrorCode`s. Should new
   error codes stay in `packages/contracts`, or should per-domain codes (e.g. scraping) get their own
   enum in later WPs?
3. R5 lists `instance` as optional. It is currently always set to the request path. Keep it, or reserve
   it for a resource URI once real resources exist?

Files the architect should review (≤5, most important first):
1. apps/backend/src/platform/security.ts — hook order, preflight exemption (R9), Host derivation.
2. apps/backend/src/platform/errors.ts — the whole error → problem+json mapping.
3. apps/backend/src/main.ts — READY line, lifecycle, shutdown ordering and the hard timeout.
4. apps/backend/src/platform/config.ts — precedence, the dev secret path and the directory checks.
5. packages/contracts/src/system.ts — ReadyLine / HealthResponse, the shell's contract.

Suggested next step:
WP-04b (SQLite + Drizzle + migration runner). The shutdown registry is empty and waiting for the DB hook,
and `<dataDir>\data` and `<dataDir>\backups-local` already exist and are proven writable at startup.
===
