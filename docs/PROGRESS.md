# Progress — newest first, keep < 150 lines

## Current
- **pre-M2b done (PARTIAL), 2 Oct 2026** (`docs/handoff/pre-M2b.md`): R75–R88 fixes, migrations 0016–0022.
  **Unmet:** R88 first page 94 ms vs 50; live runs owed (no contactEmail).
- **WP-17 done, 2 Oct 2026** (`docs/handoff/WP-17.md`): students, tags, mentorships, erasure, CSV/XLSX import (R91–R93);
  in-house XLSX reader; in-app guides on every new screen (`components/Guide.tsx`); migration 0023; papaparse@5.7.0.
- **WP-18 done, 8 Oct 2026** (`docs/handoff/WP-18.md`): teams with role labels and one lead, primary +
  co-mentors, R94 coverage (Covered/Thin/Missing) with targets, R95 lifecycle (rows closed never deleted,
  archive = read-only, transfer with Step away). Migration 0024; `GET /professors`; Student page Teams
  section; `teamMentorUserIds` feeds deactivate. UI: Teams list, Team page (member menu, Undo, typeahead,
  hand-over dialog), form; disabled controls state their reason. `lib/roving-rows.ts` shared J/K.
  e2e 4/4, a11y 33/33. **Unmet:** verify **161 s vs 120** (pre-M2a Q1).
- **WP-19 done, 8 Oct 2026** (`docs/handoff/WP-19.md`, 8 step commits): R96–R98. Contracts `engagements.ts` +
  `engagement-status.ts`; migration 0025; `domain/engagements`; `/api/v1/competitions` (assign preview/assign,
  transitions with history + audit, roster, mentors, notes, `onAssigned` hook seam for WP-20a); team archive refuses
  open competitions; Team/Student pages list them; seed adds 20. UI: assign dialog from `assign/steps.ts` (card, A,
  drawer), pipeline board (drag, M menu, arrows, Undo only Considering ↔ Assigned), list, Competition page. Both
  §19 ACs green; e2e 5/5; a11y 37/37. **Unmet:** verify **186 s vs 120** (pre-M2a Q1).
- **WP-20a done, 8 Oct 2026** (`docs/handoff/WP-20a.md`, 9 step commits): R99–R101 (v1.1.18). Contracts
  `workflow-enums/-templates/workflows.ts`; migration 0026 (+ `workflows.version`); `domain/workflows` (80-case §11
  precedence table, health reasons, due rules, R101 order); 5 seeded templates + templates API; workflow API under
  `/api/v1/competitions/:id/workflow`; copy-on-assign via `onAssigned`. UI: assign flow gains "Workflow template"
  + stage dates (board's Considering → Assigned asks too); Competition page stages/tasks/Alt+↑↓/dialogs/R100 banner;
  progress + health on board and list; Competitions → Templates. Seed shows all 5 healths. e2e 5/5, a11y 42/42.
  **Unmet:** verify **183 s vs 120** (pre-M2a Q1).
- **WP-20b PARTIAL, 8 Oct 2026** (`docs/handoff/WP-20b.md`, 7 step commits): R102–R103 (v1.1.19). Contracts
  `resources.ts` + shell `OpenRefusal`/`StatPathsResult`; migration 0027 (`resources` + version; stage/task deletes
  take their resources); `domain/resources/classify.ts`; API `/competitions/:id/resources`, `/resources…`, unaudited
  check results. Shell `open.rs` + `open_commands.rs`: open/reveal/stat_paths/machine_label, canonical target
  judged, no new crate, `core:default` kept; 20 `open::` tests (§19 "executables can't be opened"), cargo 106.
  UI: Resources per competition/stage/task, Open / Show in Explorer / Copy, status lines, web build Copy only.
  e2e 5/5, a11y 44/44. **Unmet:** manual built-app run **owed** (handoff lists steps); verify **176 s vs 120**.
- **Next: WP-21** (M2), WP-22 · 23 · 24 (M3). Every M2/M3 WP
  ends with a **UI fault sweep** and carries an in-app guide on each new screen. Send `docs/` back when M3 closes.
- **Owed live runs:** CTFtime / Devfolio smokes and `unstop:capture` wait on `scraper.contactEmail` (the
  owner's own address, R74); `clist:smoke` waits on U4.
- Spec: docs/ARCHITECTURE.md **v1.1.19 - ACCEPTED** · roadmap §19 = **50 WPs, 34 done, 16 remaining** ·
  ADR-0001...0019 · decisions register docs/DECISIONS.md.

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
- **SAC / long paths / encryption:** Smart App Control **OFF** (U1 done) · OS `LongPathsEnabled=1`
  (U2) + repo `core.longpaths=true` · **no BitLocker** → synthetic data only (D-33) · Defender
  real-time ON, **no exclusions** (U6 not taken); no CodeIntegrity or Defender blocks so far.
- **Disk cost of the toolchain:** VS Build Tools ≈ 6.7 GB · `~\.rustup` 1.28 GB · `~\.cargo` 0.5 GB · a *debug* Tauri `target/` ≈ **3.7 GB** — keep `target/` out of backups.
- **Network / proxy:** direct, no proxy. npm/crates.io/GitHub/PyPI/HuggingFace reachable.
- **Repo location:** C:\Users\Calamity\Desktop\competition-intel — **not** inside OneDrive. Dev data belongs in `%LOCALAPPDATA%\CompIntel-dev`, never in the repo.

## Standard commands
- `pnpm install --frozen-lockfile` · **`pnpm verify`** = `format:check && lint && typecheck && test`
  (**~137 s** here with 3197 tests: format 7 s, lint 26 s, typecheck ~1 s warm, test 102 s; budget is
  < 2 min per §4.15/R89 — **over**, see pre-M2a §3). **`pnpm test:a11y`** = R89's axe project
  (`*.a11y.test.tsx`, 23 tests, 9 s) — every WP touching `apps/desktop` runs and reports it, like R19's
  Rust checks. `pnpm test` runs the `node` and `desktop` projects only. **`vitest.config.ts` caps
  `maxWorkers` at 8**: this box has 8 cores, and at more the Argon2id suites starve a spawning test past
  its 20 s ceiling. `pnpm e2e` = Playwright on Edge, outside verify.
  Individually: `pnpm format` / `format:check` (Prettier) · `pnpm lint` (ESLint) · `pnpm typecheck` (`tsc -b`) ·
  `pnpm test` (Vitest, single run) · `pnpm clean` (`tsc -b --clean`).
- Git identity is repo-local: `Calamity <sohomaroy2005@gmail.com>`; `core.autocrlf=false`.
  `.gitattributes` enforces LF everywhere except `*.ps1`; Prettier also writes LF, so **never append to a
  source file with PowerShell `Add-Content`** — it writes CRLF and `format:check` fails.
- `corepack enable` **fails without admin** (EPERM on `C:\Program Files\nodejs\pnpx`). pnpm is installed
  globally via `npm i -g pnpm@12.4.2`; `packageManager` in package.json pins it regardless.
- **Test/dev data lives in `%LOCALAPPDATA%\CompIntel-dev\test-tmp`** (`src/testing/temp.ts`), never in
  the system temp folder: Windows holds SQLite handles briefly after close, so cleanup retries.
- `pnpm --filter @compintel/backend db:generate` (+ `db:generate:custom` for FTS5/triggers).
  **`drizzle-kit push` is banned** and `scripts.test.ts` fails if any manifest adds it.
  **Run `pnpm typecheck` first** whenever a schema file imports `@compintel/contracts`: drizzle-kit
  loads the package's built `dist`, so a stale build makes CHECK helpers read `undefined`.
- **`pnpm gazetteer:build`** writes `%LOCALAPPDATA%\CompIntel-dev\gazetteer\gazetteer.db` (9.5 MB since
  R82, not committed, sources cached in `gazetteer-src`). `tools/gazetteer/src/probe.ts` diffs two builds. `--mini` rebuilds the committed 53 KB test fixture with no network.
- **Windows has no POSIX signals**: `child.kill('SIGTERM')` hard-terminates; the shell's lifeline is
  stdin EOF (`--stdin-lifeline`) plus the Job Object. `fetch()` silently drops a caller-set `Host`
  header, so Host-allowlist tests must use `node:http`.
- Desktop: `tauri:dev` (Vite on **localhost:5173**, strictPort — the CORS allowlist has that exact
  origin) · `build` · `tauri:build` (= `tauri build --debug --no-bundle`) · `test:rust` ·
  `lint:rust` · `format:rust:check`. **The Rust checks are outside `pnpm verify`** (R19); run all
  three in any WP touching `src-tauri`. A dev or built run needs `backend bundle` first.
- **Vitest runs two projects** (root `vitest.config.ts`): `node` for everything, `jsdom` for
  `apps/desktop/**`. `pnpm vitest run --project desktop` runs only the UI tests. **vitest does not
  process CSS**, so a `?raw` stylesheet import is empty — `tokens.contrast.test.ts` uses `node:fs`.
- **LNA re-check** (F9, after any WebView2/Windows update): launch the exe with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks`
  and confirm the window still reaches the backend - see docs/research/webview2-local-network-access.md.
- **PATH caveat:** rustup added `%USERPROFILE%\.cargo\bin` to the *user* PATH; already-open terminals must be restarted, otherwise `cargo`/`rustc` are not found. **NodeNext:** relative imports need a `.js` extension even in `.ts` sources.

## Completed
- **pre-M2a — UI & shell faults (PARTIAL, 27 Sep).** R78 writes/links through the F9 fallback, one-button
  sign-in, R76 sealed sessions, Connect your sources, R86 live freshness, R89 a11y split; exe not click-tested.
- **WP-07b — first-run wizard + user administration** (closes M0). R39 gate = 409 `SETUP_REQUIRED` before the session
  hook; `modules/setup/` writes the whole organization in **one transaction** (R40); backup keys = `age-encryption`
  0.3.1 wrapped to a scrypt passphrase + recovery file and code (R41/R42); `modules/users/` = admin CRUD (R43).
- **WP-07a — auth core.** `permissions.ts` (R32) + `auth.ts`; migrations 0002/0003; Argon2id **m=128 MiB t=6 p=1,
  322-409 ms here** (R17), SHA-256 sessions (R33), R34 ladder, `policy.assertCan`, hash chain (R35), SSE hub (R36),
  UI token in memory only. **`/stream` must write its head through Fastify or the WebView loses the CORS headers.**
- **WP-06 — UI foundation.** Tailwind v4 + `src/styles/tokens.css`: one `--ci-*` token set, both themes, every
  text/surface pair **measured** at >= 4.5:1. `src/shell/backend.ts` is IPC only, the API client is `src/api/`
  (R27's 2 s timeout); TanStack Query + Router, cmdk palette, axe clean.
- **WP-05b — tray, close-to-tray, single instance, autostart, LNA check.** `tray-icon` +
  `tauri-plugin-single-instance` 2.4.5 and `tauri-plugin-autostart` 2.5.1; preferences in
  `<dataDir>\shell-settings.json` (R28), close-to-tray on by default (D-14). `loopback.rs` serves the
  prefix-locked `backend_get` — the **F9 fallback** (R27). **LNA measured**: with the flags on the
  loopback `fetch` *never settles*, so the fallback runs on a timeout.
- **WP-05a — Tauri shell + backend supervision.** `apps/desktop` (React 19 + Vite 8, own tsconfig, R6),
  `src-tauri` inside, toolchain pinned 1.98.1 (R1); Rust `backoff`/`ready`/`secret`/`paths`/`job`/
  `supervisor`/`commands` (R7, A2, A20, F7/A17); `contracts/src/shell.ts` types the IPC (R24).
- **WP-04c — DB-backed job runner.** Migration 0001 = `job_state`; `contracts/src/jobs.ts`. `src/jobs/`: `outcome`,
  `store` (conditional-UPDATE claim = single-flight), `run`, `scheduler` (30 s tick, catch-up, 2 scrape / 1 LLM /
  4 general, stale lease → CRASHED, SKIPPED_OFFLINE, manual `trigger()`). **WP-09a registered the first jobs.**
- **WP-04b — SQLite + Drizzle + migrations + data-dir lock + UUIDv7.** better-sqlite3 13.0.3,
  drizzle-orm 0.45.2. `ids.ts` UUIDv7 (RFC 9562, monotonic); `lock.ts` (R15); `db.ts` R16 PRAGMAs +
  `quick_check`; `migrate.ts` + `VACUUM INTO` pre-migration copies (keep 5); 0000 = `app_meta`.
- **WP-04a — backend app factory**. zod config (flags > env > defaults), pino `multistream` → daily-rotating file
  (keep 14) + deep redaction, `AppError` → RFC 9457 `problem+json` (R5) with `X-Request-Id`, Host +
  `X-CompIntel-Client` + CORS (R9), `/health`, `buildApp()` + `main.ts` (READY line, stdin EOF, 10 s timeout).
- **WP-03a/03b — toolchain + monorepo scaffold.** VS Build Tools 2022, rustup stable-msvc, pnpm
  workspace, engines `>=24.19 <25`, save-exact. **TypeScript 6.0.3**, not 7.x (typescript-eslint caps
  at `<6.1.0`). Probe A: SQLite 3.53.4 WAL + FTS5, `VACUUM INTO` 2.9 ms, argon2 prebuilds only.
- **WP-00…WP-02b — recon, spec, ADRs, source feasibility** (d159c78…ef8bd55; review → v1.1 in d781885).
  **Source matrix** (`docs/research/source-feasibility.md`, its verdicts bind): CTFtime/CLIST/Devfolio
  APPROVED_WITH_LIMITS, **Devpost and Unstop MANUAL_IMPORT_ONLY**, 117 college sites PENDING_REVIEW;
  fixtures + 13 robots.txt under `docs/research/` — WP-09a's seeds are asserted against them.
## Open issues
All WP-01/WP-02 findings are ruled on in ARCHITECTURE.md §21. Still open:
1. **U4** — CLIST API key (blocks live WP-11 runs). U3 done 21 Sep 2026 (R70).
2. **Pilot host unknown** (Q2/Q10): check its SAC/WDAC state and disk encryption before WP-31.
3. **No 8 GB test machine**: needed for WP-31/32 (real laptop or VirtualBox VM).
4. **Disk headroom: 35 GB free.** `target/` reached 11.2 GB before pre-M1 cleaned it and is 3.7 GB now;
   a debug rebuild from empty is ~2 min. R3 says clean again under 20 GB. WP-15/26/27 add models.
5. Q9, Q11, Q12 open with defaults (DECISIONS.md). **Q1, Q3, Q4, Q5, Q6, Q7, Q8 closed.**
6. No BitLocker here → synthetic data only (D-33). The dev admin in `%LOCALAPPDATA%\CompIntel-dev` has
   password `pre-M1-manual-check-2026`, set out-of-band for pre-M1's GUI check.
