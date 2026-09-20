# Progress — newest first, keep < 150 lines

## Current
- **pre-M1 DONE** (21 Sep 2026, `docs/handoff/pre-M1.md`) — consolidation, **no behaviour change**.
  `platform/time.ts` = one `Clock` + local-day arithmetic; `src/domain/` with four linter-enforced
  boundary rules + `max-lines: 400`; `withAudit()`; settings `define()`d by the owning module;
  `testing/golden.ts`; R12 error blocks; M0 debt cleared. 1790 tests; built exe verified.
  **Open for the architect:** `jobs/schedule.ts` cannot move to `domain/` until
  `JobDefinition.nextDueAt` stops being typed against the Drizzle row (handoff §4).
- **WP-08a IN PROGRESS** (~65%, `b9a6408`) — **read `docs/handoff/WP-08a.md` before writing any code.**
  Done and green: rulings R48-R52 / spec v1.1.7 · contracts `events.ts` + `event-candidate.ts`
  (`.strict()`, R50) · migration **0004** = event_series, events, event_deadlines, event_field_claims,
  event_overrides, event_changes, institutions (R48; `source_record_id` carries no FK, R49) ·
  `domain/normalize/` (11 modules, pure + clock-injected, R52) · **153 table-driven cases**.
  **Left:** enum/CHECK tests · migration tests for the new tables · PII sweep over the fixtures ·
  two golden files · a fast-check property test · `pnpm audit:deps` · PROGRESS + the closing report.
  New deps: chrono-node 2.10.1, sanitize-html 2.17.7, turndown 7.2.4 (+2 @types, dev).
  **1979 tests** (was 1790).
- **Architect reviewed M0** (20 Sep 2026, `docs/handoff/M0-review.md`): R1–R44 accepted as written, plus
  R45–R47 (recovery-code sign-in → WP-30, Argon2id calibration deferred, `/system/shutdown` exemption).
  **Q1 RESOLVED** — standalone single-professor deployment, §3.1 amended, accounts/RBAC/audit retained.
  ADR-0010/0011 amended (R33/R34/R37/R38, R41/R42); DECISIONS.md drift fixed (U1/U2, Q3).
- **M1 released as a batch**; `docs/prompts/` is organized by milestone (index: `prompts/README.md`).
  Order: **`M1/pre-M1.md` first** (consolidation refactor, no behaviour change), then WP-08a · 08b · 09a ·
  09b · 10 · 11 · 12 · 13 · 14 · 15a · 15b · 16a · 16b. Zip `docs/` and send it back when M1 closes.
  **§21 R48–R66 are reserved** for the STEP 0 blocks of WP-08a…WP-10.
- **New: WP-33** (`prompts/M4/WP-33.md`, milestone **M4.5**, just before M5) — appearance system
  (Catppuccin palettes, CALM/STANDARD/SHOWCASE effect tiers, motion & glow) + Insights. ADR-0019, R67–R69.
- **Owner, 20 Sep 2026:** standalone app — one professor, one machine (§3.1). Security posture reviewed and **left unchanged**; less security framing in prose from here on.
- Spec: docs/ARCHITECTURE.md **v1.1.7 — ACCEPTED** (§21 R1–R52 + R67–R69; §19 = **48 WPs, 16 done, 32 remaining**).
- ADR-0001…0019 Accepted. Decisions register: docs/DECISIONS.md (D-01…D-33, Q1 RESOLVED, U1/U2 DONE).

## Environment facts
- **OS / CPU / RAM / GPU:** Windows 11 **Home** 25H2 (build 26200.9457) · AMD Ryzen 7 5700, 8c/16t · 16 GB RAM ·
  NVIDIA RTX 4060 8 GB · no NPU · **C: 35 GB free of 119 GB** (pre-M1's `cargo clean` removed 11.2 GiB /
  11 443 files; a debug `target/` rebuilt from empty is **3.7 GB** and takes **~2 min**).
  This box is the **GPU tier**, not the 8 GB target; Home edition has no Hyper-V, so there is no 8 GB test VM (affects WP-15, WP-31).
- **Toolchain (all verified WP-03a):** node **v24.19.0** · npm **11.17.0** · pnpm **12.4.2** (`%APPDATA%\npm`, on PATH) ·
  rustup **1.29.1** · rustc/cargo **1.98.1** (`stable-x86_64-pc-windows-msvc`, default host, only target installed) ·
  **VS Build Tools 2022 17.14.41** (`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`) with
  MSVC **14.44.35207** + **Windows 11 SDK 10.0.26100.0** · tauri-cli **2.11.4** · create-tauri-app 4.7.4 ·
  python 3.13.15 · git 2.55.0.windows.3 · winget 1.29.290 · WebView2 runtime 153.0.4234.32.
  **Still absent (do not install without approval):** dotnet, pwsh 7, llama.cpp, any model.
- **SAC / long paths / encryption:** Smart App Control **OFF** (`VerifiedAndReputablePolicyState=0`, U1 done) ·
  OS **`LongPathsEnabled=1`** (U2 done) + repo `core.longpaths=true` · **no BitLocker** → synthetic data only (D-33) ·
  Defender real-time ON, tamper protection ON, **no exclusions** (U6 not taken). No CodeIntegrity or Defender
  block events during the toolchain install or the first unsigned Tauri build.
- **Disk cost of the toolchain:** VS Build Tools ≈ 6.7 GB · `~\.rustup` 1.28 GB · `~\.cargo` 0.5 GB · a *debug* Tauri `target/` ≈ **3.7 GB** — keep `target/` out of backups.
- **Network / proxy:** direct, no proxy. npm/crates.io/GitHub/PyPI/HuggingFace reachable.
- **Repo location:** C:\Users\Calamity\Desktop\competition-intel — **not** inside OneDrive. Dev data belongs in `%LOCALAPPDATA%\CompIntel-dev`, never in the repo.

## Standard commands
- `pnpm install --frozen-lockfile` · **`pnpm verify`** = `format:check && lint && typecheck && test`
  (~60 s here with 1790 tests; budget is < 2 min per §4.15).
  Individually: `pnpm format` / `format:check` (Prettier) · `pnpm lint` (ESLint) · `pnpm typecheck` (`tsc -b`) ·
  `pnpm test` (Vitest, single run) · `pnpm clean` (`tsc -b --clean`).
- Git identity is repo-local: `Calamity <sohomaroy2005@gmail.com>`; `core.autocrlf=false`.
  `.gitattributes` enforces LF everywhere except `*.ps1`; Prettier also writes LF, so **never append to a
  source file with PowerShell `Add-Content`** — it writes CRLF and `format:check` fails.
- `corepack enable` **fails without admin** (EPERM on `C:\Program Files\nodejs\pnpx`). pnpm is installed
  globally via `npm i -g pnpm@12.4.2`; `packageManager` in package.json pins it regardless.
- **Test/dev data lives in `%LOCALAPPDATA%\CompIntel-dev\test-tmp`** (`src/testing/temp.ts`), never in
  the system temp folder: Windows holds SQLite handles briefly after close, so cleanup must be retrying.
- `pnpm --filter @compintel/backend db:generate` (+ `db:generate:custom` for FTS5/triggers).
  **`drizzle-kit push` is banned** and `scripts.test.ts` fails if any manifest adds it.
  **Run `pnpm typecheck` first** whenever a schema file imports `@compintel/contracts`: drizzle-kit loads
  the package's built `dist`, so a stale build makes CHECK-constraint helpers read `undefined`.
- Backend: `pnpm --filter @compintel/backend dev` (tsx watch, `--dev`) · `start` · `bundle` (esbuild → `dist-bundle/`)
  · `smoke:bundle`. Root `pnpm audit:deps` (network, R4) is **outside** verify.
- **Windows has no POSIX signals**: `child.kill('SIGTERM')` hard-terminates. The shell's real lifeline is
  stdin EOF (`--stdin-lifeline`) plus the Job Object; `fetch()` also silently drops a caller-set `Host` header,
  so Host-allowlist tests must use `node:http`.
- Desktop: `pnpm --filter @compintel/desktop tauri:dev` (Vite on **localhost:5173**, strictPort - the CORS
  allowlist has that exact origin) · `build` (tsc + vite) · `tauri:build` (= `tauri build --debug
  --no-bundle`) · `test:rust` · `lint:rust` (clippy `-D warnings`) · `format:rust:check`. **The Rust checks
  are outside `pnpm verify`** (R19); run all three in any WP that touches `src-tauri`. A dev or built run
  needs `pnpm --filter @compintel/backend bundle` first.
- **Vitest runs two projects** (root `vitest.config.ts`): `node` for everything, `jsdom` for
  `apps/desktop/**` (setup `apps/desktop/src/testing/setup.ts`: jest-dom, the axe matcher, matchMedia).
  `pnpm vitest run --project desktop` runs only the UI tests. **vitest does not process CSS**, so a
  `?raw` import of a stylesheet comes back empty - `tokens.contrast.test.ts` reads the file with `node:fs`.
- **LNA re-check** (F9, after any WebView2/Windows update): launch the exe with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks`
  and confirm the window still reaches the backend - see docs/research/webview2-local-network-access.md.
- **PATH caveat:** rustup added `%USERPROFILE%\.cargo\bin` to the *user* PATH; already-open terminals must be restarted, otherwise `cargo`/`rustc` are not found. **NodeNext:** relative imports need a `.js` extension even in `.ts` sources.

## Completed
- **WP-07b — first-run wizard + user administration** (closes M0). R39 gate = 409 `SETUP_REQUIRED`
  before the session hook (exempt: `/health`, `/setup/*`, `/system/client-log`, `/system/shutdown`);
  `modules/setup/` writes organization + department + campus + first admin + settings + age keys in
  **one transaction** (R40); `modules/backup/keys.ts` = `age-encryption` 0.3.1 X25519 identity wrapped
  to a scrypt passphrase (**work factor 18**) + the recovery-file text (R42); one-time recovery code
  hashed into `auth.recoveryCodeHash` (R41). `modules/users/` = admin CRUD, last-admin protection,
  `version` 409s. Shell `files.rs`: `pick_folder`/`save_text_file` limited to a folder picked in this
  run (R43, `tauri-plugin-dialog` 2.7.3). 1736 tests; cargo 56; `smoke:bundle` drives the wizard.
- **WP-07a — auth core.** Contracts `permissions.ts` (R32) + `auth.ts`; migrations 0002/0003
  (organization + identity + `audit_log`, append-only triggers, roles); `modules/auth/` — Argon2id
  **m=128 MiB t=6 p=1, 322-409 ms here** (R17 addon path), opaque SHA-256 sessions (R33), the R34 lockout
  ladder, `policy.assertCan`; `platform/` audit hash chain + `verifyChain` (R35), session preHandler (R38),
  SSE hub (R36); routes `/auth/*`, `/me`, `/me/permissions`, `/stream`, `/system/client-log`. UI: login/lock/
  forced-change, idle timer, rail and routes by permission, **token in memory only**, SSE client with R30
  degradation. **`/stream` must write its head through Fastify or the WebView loses the CORS headers.**
- **WP-06 — UI foundation.** Tailwind v4 + `src/styles/tokens.css`: one `--ci-*` token set, both themes via
  `@theme inline`, every text/surface pair **measured** at >= 4.5:1 in a test; light/dark/**system**.
  `src/shell/backend.ts` is IPC only; the API client lives in `src/api/` (typed `ApiProblem`, `Authorization`
  seam, generation retry, R27's **2 s** timeout). TanStack Query + Router, app shell, cmdk palette,
  ErrorBoundary/toasts/Skeleton/EmptyState, `<ConnectionScreen>` (R26). Vitest `node` + `jsdom`; axe clean.
- **WP-05b — tray, close-to-tray, single instance, autostart, LNA check.** Tray menu via `tray-icon` +
  `tauri-plugin-single-instance` 2.4.5 and `tauri-plugin-autostart` 2.5.1; preferences in
  `<dataDir>\shell-settings.json` (R28), close-to-tray on by default (D-14). `loopback.rs` serves the
  prefix-locked `backend_get` — the **F9 fallback** (R27). **LNA measured**: with the flags on, the
  loopback `fetch` *never settles*, so the fallback runs on a timeout.
- **WP-05a — Tauri shell + backend supervision.** `apps/desktop` (React 19 + Vite 8, own tsconfig per R6),
  `src-tauri` inside; `rust-toolchain.toml` pins 1.98.1 (R1). Rust: `backoff` (1→2→4…60 s, 5 crashes/10 min →
  FAILED), `ready` (R7), `secret` (32 fresh bytes per spawn, A2), `paths` (A20 + `COMPINTEL_DATA_DIR`), `job`
  (KILL_ON_JOB_CLOSE, F7/A17), `supervisor`, `commands`; `contracts/src/shell.ts` types the IPC (R24).
- **WP-04c — DB-backed job runner.** Migration 0001 = `job_state`; `contracts/src/jobs.ts` (JobKind
  SCRAPE/LLM/GENERAL, JobTrigger, JobOutcome + ABORTED/CRASHED, JobSnapshot). `src/jobs/`: `outcome`
  (state machine), `store` (conditional-UPDATE claim = single-flight), `run`, `scheduler` (30 s tick,
  catch-up, 2 scrape / 1 LLM / 4 general, stale lease → CRASHED, SKIPPED_OFFLINE, manual `trigger()`),
  `online`; the arithmetic is `domain/scheduling.ts` since pre-M1. **No jobs registered** — each WP adds its own.
- **WP-04b — SQLite + Drizzle + migrations + data-dir lock + UUIDv7.** better-sqlite3 13.0.3, drizzle-orm
  0.45.2 (drizzle-kit 0.31.10 dev). `ids.ts` UUIDv7 (RFC 9562, monotonic, clock-regression safe); `lock.ts`
  `<dataDir>\backend.lock` (R15); `db.ts` R16 PRAGMAs + `quick_check` + checkpoint/close; `migrate.ts` journal
  pending detection + `VACUUM INTO backups-local\pre-migration-*.db` (keep 5) → MIGRATION_FAILED on failure;
  migration 0000 = `app_meta`; no `drizzle-kit push` (a test enforces it). Plus the WP-04a review fixes
  R11–R18 and the bundle's `native\` + `migrations\` (R17).
- **WP-04a — backend app factory**. zod config (flags > env > defaults), pino `multistream` → daily-rotating
  file (keep 14) + deep redaction, `AppError` → RFC 9457 `problem+json` (R5) with `X-Request-Id`, Host +
  `X-CompIntel-Client` (`timingSafeEqual`) + CORS (R9), `/health`, `/system/shutdown`, `buildApp()` +
  `main.ts` (READY line, stdin EOF, 10 s hard timeout). Deps: fastify 5.12.5, @fastify/cors 11.3.0,
  fastify-type-provider-zod 7.0.0, pino 10.3.1, zod 4.6.5, tsx 4.23.13, esbuild 0.28.2.
- **WP-03a/03b — toolchain + monorepo scaffold.** VS Build Tools 2022, rustup stable-msvc, pnpm workspace,
  engines `>=24.19 <25`, save-exact. **TypeScript 6.0.3**, not 7.x (typescript-eslint caps at `<6.1.0`).
  Probe A: SQLite 3.53.4 WAL + FTS5 porter/trigram, `VACUUM INTO` 2.9 ms, argon2 prebuilds only.
- **WP-00…WP-02b — recon, spec, ADRs, source feasibility** (d159c78…ef8bd55; review → v1.1 in d781885).
  **Source matrix** (`docs/research/source-feasibility.md`): CTFtime/CLIST/Devfolio APPROVED_WITH_LIMITS
  (CLIST needs a key), **Devpost and Unstop MANUAL_IMPORT_ONLY**, 117 college sites PENDING_REVIEW;
  fixtures + 13 robots.txt under `docs/research/`.

## Open issues
All WP-01/WP-02 findings are ruled on in ARCHITECTURE.md §21. Still open:
1. **U3** — Unstop Terms unread (blocks WP-13). **U4** — CLIST API key (blocks live WP-11 runs).
2. **Pilot host unknown** (Q2/Q10): check its SAC/WDAC state and disk encryption before WP-31.
3. **No 8 GB test machine**: needed for WP-31/32 (real laptop or VirtualBox VM).
4. **Disk headroom: 35 GB free.** `target/` reached 11.2 GB before pre-M1 cleaned it and is 3.7 GB now;
   a debug rebuild from empty is ~2 min. R3 says clean again under 20 GB. WP-15/26/27 add models.
5. Q6–Q9, Q11, Q12 open with defaults (DECISIONS.md); Q4 blocks WP-23. **Q1, Q3, Q5 closed** (Q5 → R32).
6. No BitLocker here → synthetic data only (D-33). The dev admin in `%LOCALAPPDATA%\CompIntel-dev` has
   password `pre-M1-manual-check-2026`, set out-of-band for pre-M1's GUI check.
