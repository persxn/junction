# Progress — newest first, keep < 150 lines

## Current
- **Next WP: WP-08a.** M0 is complete: WP-07b shipped the first-run wizard and user administration.
- **Architect is offline** (Sep 2026): this session acts as master + worker. Every architectural call is
  recorded in the handoff reports under "Minor decisions"/"Questions" for review when they are back.
- Spec: docs/ARCHITECTURE.md **v1.1.5 — ACCEPTED** (changelog at the top; rulings index §21 incl. R1–R44; roadmap §19 = 46 WPs, 14 done, 32 remaining).
- ADR-0001…0018 Accepted (several amended). Decisions register: docs/DECISIONS.md (D-01…D-33, Q1…Q13, user actions U1…U6).

## Environment facts
- **OS / CPU / RAM / GPU:** Windows 11 **Home** 25H2 (build 26200.9457) · AMD Ryzen 7 5700, 8c/16t · 16 GB RAM ·
  NVIDIA RTX 4060 8 GB · no NPU · **C: 31 GB free of 119 GB** (single fixed drive; 52 GB before the
  toolchain; `apps/desktop/src-tauri/target` alone is 8.0 GB).
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
- **Disk cost of the toolchain:** VS Build Tools ≈ 6.7 GB · `~\.rustup` 1.28 GB · `~\.cargo` 0.5 GB ·
  a *debug* Tauri `target/` ≈ **3.2 GB** per app — budget for this from WP-04a on and keep `target/` out of backups.
- **Network / proxy:** direct, no proxy. npm/crates.io/GitHub/PyPI/HuggingFace reachable.
- **Repo location:** C:\Users\Calamity\Desktop\competition-intel — **not** inside OneDrive.
  Dev data belongs in `%LOCALAPPDATA%\CompIntel-dev`, never in the repo.

## Standard commands
- `pnpm install --frozen-lockfile` · **`pnpm verify`** = `format:check && lint && typecheck && test`
  (~6 s here, ~7 s from a cold clone; budget is < 2 min per §4.15).
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
- **PATH caveat:** rustup added `%USERPROFILE%\.cargo\bin` to the *user* PATH; already-open terminals must be
  restarted or prepend it manually, otherwise `cargo`/`rustc` are not found.
- **NodeNext:** relative imports need a `.js` extension even in `.ts` sources.
- `npm i -g` now warns about unrun install scripts (npm 11.17 `allow-scripts` gate) — harmless for pnpm's shim.

## Completed
- **WP-07a — auth core** (this WP). Contracts `permissions.ts` (R32 matrix, ~500 generated cases) + `auth.ts`;
  migrations 0002/0003 (organization + identity + `audit_log`, append-only triggers, seeded roles);
  `modules/auth/` — Argon2id **m=128 MiB t=6 p=1, 322-409 ms measured here** (R17 addon path), opaque
  SHA-256-hashed sessions (R33), the R34 lockout ladder, `policy.assertCan` off the contracts map;
  `platform/` audit hash chain + `verifyChain` (R35), typed settings, the session preHandler (R38), SSE hub
  (R36); routes `/auth/*`, `/me`, `/me/permissions`, `/stream`, `/system/client-log`. UI: login/lock/forced-change
  screens, idle timer, admin rail and routes by permission, **token in memory only** (asserted), SSE client with
  the R30 polling degradation. `backend_get` forwards `Authorization` (R27). **1607 tests** (1347 node + 260
  desktop). **Fixed on the built app: `/stream` wrote its head raw and dropped the CORS headers, so the WebView
  blocked every stream** — now carried over, with a test. `seed:dev` makes the first accounts until WP-07b.
- **WP-06 — UI foundation.** Tailwind v4 (`@tailwindcss/vite`) + `src/styles/tokens.css`: one `--ci-*` token
  set, both themes, mapped onto Tailwind's namespaces with `@theme inline`, so `[data-theme='dark']` re-points
  every utility at once; every text/surface pair is **measured** at >= 4.5:1 in a test. Theme light/dark/**system**.
  `src/shell/backend.ts` is IPC only; the API client lives in `src/api/` (typed `ApiProblem`, `Authorization`
  seam, generation retry, R27's **2 s** timeout). TanStack Query + Router, app shell (collapsible rail, top bar,
  user menu), cmdk palette, ErrorBoundary/toasts/Skeleton/EmptyState, `<ConnectionScreen>` for the R26 cases.
  Vitest split into `node` + `jsdom` projects; axe clean on every route. Manual run verified incl.
  DATA_DIR_LOCKED → Retry → shell.
- **WP-05b — tray, close-to-tray, single instance, autostart, LNA check.** Tray menu (Open · Close to
  tray · Start with Windows · Open logs · Exit completely) via the `tray-icon` feature +
  `tauri-plugin-single-instance` 2.4.5 and `tauri-plugin-autostart` 2.5.1; preferences in
  `<dataDir>\shell-settings.json` (R28), close-to-tray on by default (D-14). `loopback.rs` also serves the
  read-only, prefix-locked `backend_get` — the **finding-F9 fallback** (R27). **LNA measured**
  (docs/research/webview2-local-network-access.md): with the flags on the loopback `fetch` *never settles*,
  so the fallback is driven by a timeout, not a rejection. 439 tests; cargo 46; A-D end-to-end passes.
- **WP-05a — Tauri shell + backend supervision.** `apps/desktop` (React 19 + Vite 8, own tsconfig per R6)
  with `src-tauri` inside; `rust-toolchain.toml` pins 1.98.1 (R1). Rust: `backoff` (1→2→4…60 s, 5 crashes/
  10 min → FAILED), `ready` (R7), `secret` (32 fresh bytes per spawn, A2), `paths` (A20), `job`
  (KILL_ON_JOB_CLOSE, F7/A17), `supervisor`, `commands` + the `backend://status` event;
  `packages/contracts/src/shell.ts` types the IPC and the UI parses it (R24). A named startup error is
  terminal, not a restart loop (R26). **Verified on the built exe:** clean exit 0 with no leftovers, a hard
  kill takes the backend with it, WebView2 reached `/api/v1/health` 200.
- **WP-04c — DB-backed job runner.** Migration 0001 = `job_state` (§6.2 columns + `kind`, `last_outcome`,
  `last_duration_ms`, `last_error_message`, CHECKs from the contracts enums, index on `next_due_at`);
  `packages/contracts/src/jobs.ts` (JobKind SCRAPE/LLM/GENERAL, JobTrigger, JobOutcome + ABORTED/CRASHED,
  JobSnapshot). `apps/backend/src/jobs/`: `schedule` (jitter, 15→30→60 min…12 h), `outcome` (state
  machine), `store` (conditional-UPDATE claim = single-flight), `run`, `scheduler` (30 s tick, catch-up,
  2 scrape / 1 LLM / 4 general, stale lease → CRASHED, SKIPPED_OFFLINE, manual `trigger()`, `resources`
  stop hook), `online` (interface-table check, no network call). Wired in `main.ts` with **no jobs
  registered** — each later WP registers its own. 422 tests green. **No new dependencies.**
- **WP-04b — SQLite + Drizzle + migrations + data-dir lock + UUIDv7.** better-sqlite3 13.0.3, drizzle-orm
  0.45.2 (drizzle-kit 0.31.10 dev). `ids.ts` UUIDv7 (RFC 9562, monotonic, clock-regression safe); `lock.ts`
  `<dataDir>\backend.lock` (R15); `db.ts` R16 PRAGMAs + `quick_check` + checkpoint/close; `migrate.ts`
  journal pending detection + `VACUUM INTO backups-local\pre-migration-*.db` (keep 5), failure →
  MIGRATION_FAILED; migration 0000 = `app_meta`; no `drizzle-kit push` (a test enforces it). Also the
  WP-04a review fixes R11–R18 and the bundle's `native\` + `migrations\` (R17). 340 tests green.
- **WP-04a — backend app factory**. `apps/backend`: zod config (flags > env > defaults, `--data-dir`,
  `PORT`, `--dev`, `--stdin-lifeline`, dirs `data/logs/tmp/backups-local` created + write-probed), pino via
  `multistream` → in-house daily-rotating file (keep 14, injectable clock) + stderr in `--dev`, deep key-based
  redaction, `AppError` → RFC 9457 `problem+json` (R5) with `X-Request-Id` everywhere, Host + `X-CompIntel-Client`
  (`timingSafeEqual`) + `@fastify/cors` (R9), `GET /api/v1/health`, `POST /api/v1/system/shutdown`,
  `buildApp()` (no listen) + `main.ts` (READY line, signals, stdin EOF, 10 s hard timeout, empty shutdown registry).
  Deps: fastify 5.12.5, @fastify/cors 11.3.0, fastify-type-provider-zod 7.0.0, pino 10.3.1, zod 4.6.5,
  tsx 4.23.13, esbuild 0.28.2 (needs `allowBuilds`). 217 tests green. Rulings R1–R10 → §21 (spec v1.1.1).
- **WP-03b — monorepo scaffold + `pnpm verify`**. pnpm workspace (`apps/*`, `packages/*`, `tools/*`),
  engines `>=24.19 <25`, `.npmrc` save-exact + engine-strict. **TypeScript 6.0.3** — not 7.0.2, because
  typescript-eslint 8.70.0 supports `>=4.8.4 <6.1.0`. ESLint 10.11.0 flat config (TypeChecked +
  `no-explicit-any`, `no-floating-promises`, `consistent-type-imports`), Prettier 3.9.8 (`docs/` excluded),
  Vitest 5.0.1. `packages/contracts` (zod 4.6.5): API_VERSION, the 5 spec enums, ProblemDetails + ErrorCode.
  Verified green from a fresh `git clone` + `--frozen-lockfile`; injected lint/type/test faults each exit 1.
- **WP-03a — toolchain install + build probes.** VS Build Tools 2022, rustup + stable-msvc, pnpm 12.4.2.
  **Probe A**: better-sqlite3 → SQLite 3.53.4, WAL, FTS5 porter + trigram, a JS `haversine()` from SQL,
  `db.backup()` 4.1 ms, `VACUUM INTO` 2.9 ms; @node-rs/argon2 2.2.1 argon2id m=19456/t=2/p=1 →
  **12.8 ms per hash**. Prebuilds only. **Probe B**: a Tauri 2 hello world built in **2m 13s** cold.

- **WP-00…WP-02b — recon, spec, ADRs, source feasibility** (d159c78, 6955690, 58f7f4f, 7b61c80, ef8bd55;
  architect review → spec v1.1 in d781885). Repo and docs/ tree; ARCHITECTURE.md verbatim + ADR-0001…0015 +
  DECISIONS.md; docs/handoff/WP-01-review.md (10 findings, 20 ambiguities, per-WP sizes and splits);
  **source matrix** in docs/research/source-feasibility.md — CTFtime/CLIST/Devfolio APPROVED_WITH_LIMITS
  (CLIST blocked on an API key), **Devpost and Unstop MANUAL_IMPORT_ONLY**, 117 college sites PENDING_REVIEW;
  sanitized fixtures for CTFtime + Devfolio; 13 platform robots.txt in docs/research/robots/.

## Open issues
All WP-01/WP-02 findings are ruled on in ARCHITECTURE.md §21. Still open:
1. ~~U1/U2~~ **done in WP-03a.** **U3** — Unstop Terms unread (blocks WP-13). **U4** — CLIST API key (blocks live WP-11 runs).
2. **Pilot host unknown** (Q2/Q10): check its SAC/WDAC state and disk encryption before WP-31.
3. **No 8 GB test machine**: needed for WP-31/32 (real laptop or VirtualBox VM).
4. **Disk headroom: 31 GB free.** `apps/desktop/src-tauri/target` alone is **8.0 GB**. R3 says `cargo clean` under 20 GB free; WP-15/26/27 add models, so this is the next thing to bite.
5. Q1, Q5–Q9, Q11, Q12 open with defaults (DECISIONS.md); Q4 blocks WP-23. **Q3 closed by WP-07b** (the wizard collects the campus).
6. No BitLocker here → synthetic data only (D-33).
