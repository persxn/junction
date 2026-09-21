# Progress — newest first, keep < 150 lines

## Current
- **pre-M1 · WP-08a · WP-08b · WP-09a DONE** (handoffs in `docs/handoff/`): one `Clock`, lint-enforced domain
  boundaries, settings registry, goldens; `EventCandidate` + normalization; gazetteer/geocoder/policies (R53–R57);
  PoliteHttpClient, compliance gate, source seeds, scrape runs (R58–R61). Open: `jobs/schedule.ts` → `domain/`.
  **WP-09b PARTIAL** — CTFtime adapter; manual live smoke not run (no `scraper.contactEmail` on the dev DB).
- **WP-10 DONE** (`docs/handoff/WP-10.md`) — dedup (§7.5, R64 first), merge/unmerge (R66, nothing deleted),
  resolution by field group, change detection, admin review API; migration 0008; scrapes now create events.
- **WP-11 DONE** (`docs/handoff/WP-11.md`) — CLIST adapter (key-gated; no key → BLOCKED_BY_POLICY, zero requests),
  migration 0009, secret credential settings + routes, seed-only robots exemption (proposed ruling), `domain/series/`,
  main feed vs Contest Calendar readers; `clist:smoke` skipped (U4 open).
- **Owner ruling R74 / D-34 (21 Sep 2026, spec v1.1.12):** Devfolio and Unstop may be read with the professor's
  own session (pasted cookie or in-app login window), read-only, same gate; built in **WP-14** (prompt amended).
  §7.2 "Never", ADR-0007 and ADR-0016 amended. D-29 still drops other people's data. WP-13 lands as v1.1.13.
- **WP-12 DONE** (approved 21 Sep 2026, `docs/handoff/WP-12.md`) — Devfolio adapter, per-subdomain robots,
  `api.devfolio.co` refused before the transport, PII allowlist; migration 0010; cheerio 1.2.0. Live smoke owed.
- **WP-13 PARTIAL** (21 Sep 2026, `docs/handoff/WP-13.md`) — Unstop adapter via `/api/public/*` + `ng-state` fallback,
  deny list before the transport, R70–R73, migration 0011. `unstop:capture` (capture + smoke, gated) refuses while
  `scraper.contactEmail` is unset, so **fixtures stay synthetic and the capture is owed**.
- **Owner product flow (21 Sep 2026):** each professor installs the app; onboarding opens the packaged sign-in browser
  for every approved source; the UA contact is that professor's own address (R74, WP-14 prompt).
- **WP-14 DONE** (22 Sep 2026, `docs/handoff/WP-14.md`) — manual entry + URL import (Devpost: zero requests, spy-proved)
  through WP-10's linker (migration 0012, overrides survive scrapes) + signed-in sessions (R74/D-34, own-host only,
  EXPIRED without backoff, Tauri sign-in window). UI `/events/new`, Admin → Sources sessions. 2739 tests, 61 Rust.
- **WP-15a DONE** (22 Sep 2026, `docs/handoff/WP-15a.md`) — strict `EventQuery` + pure planner (A6/A7 golden-tested),
  migrations **0013** (vocabulary, aliases, `event_user_state`/`watchlist_items` pulled forward from WP-16a) and **0014**
  (FTS5 words + trigram via view `event_search_source`, 3 triggers, backfill, alias seed); typo = vocabulary + OSA
  distance, separate from trigram; signed keyset cursors; `POST /search/events`, `GET /events/:id`, alias admin.
  `pnpm perf:search` (20k events, outside verify): p95 filters 21.7 · text 34.7 · distance 31.0 · detail 0.9 ms.
  `categories`/`tags` filters 400 until stored (Q: where do tags come from?). Journal `when` ordering now tested.
  **2873 tests.** Next: **WP-15b**. Roadmap 25 done, 23 remaining.
- WP-08b's two questions are still open (handoff §6): the gazetteer is 68.5 MB of
  which 95% are zero-population hamlets that also *harm* matching — §4.17 says "towns/cities" where
  R53 says feature class P; and GeoNames has almost no Indian campuses, so the INSTITUTION rung is
  mostly unreachable. Q12 stays OPEN in ARCHITECTURE.md §2 and DECISIONS.md.
- **Architect reviewed M0** (20 Sep 2026, `docs/handoff/M0-review.md`): R1–R44 accepted as written, plus
  R45–R47 (recovery-code sign-in → WP-30, Argon2id calibration deferred, `/system/shutdown` exemption).
  **Q1 RESOLVED** — standalone single-professor deployment, §3.1 amended, accounts/RBAC/audit retained.
  ADR-0010/0011 amended (R33/R34/R37/R38, R41/R42); DECISIONS.md drift fixed (U1/U2, Q3).
- **M1 released as a batch** (`docs/prompts/`, index `prompts/README.md`). Order: pre-M1 · WP-08a ·
  **08b** · **09a** · 09b · 10 · 11 · 12 · 13 · 14 · 15a · 15b · 16a · 16b (first four done).
  Zip `docs/` and send it back when M1 closes. §21 R62–R66 stay reserved.
- **New: WP-33** (`prompts/M4/WP-33.md`, milestone **M4.5**, just before M5) — appearance system
  (Catppuccin palettes, CALM/STANDARD/SHOWCASE effect tiers, motion & glow) + Insights. ADR-0019, R67–R69.
- **Owner, 20 Sep 2026:** standalone app — one professor, one machine (§3.1). Security posture left unchanged; less security framing in prose from here on.
- Spec: docs/ARCHITECTURE.md **v1.1.11 — ACCEPTED** (§21 R1–R66 + R67–R69; §19 = **48 WPs, 20 done, 28 remaining**).
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
- **SAC / long paths / encryption:** Smart App Control **OFF** (U1 done) · OS `LongPathsEnabled=1`
  (U2) + repo `core.longpaths=true` · **no BitLocker** → synthetic data only (D-33) · Defender
  real-time ON, **no exclusions** (U6 not taken); no CodeIntegrity or Defender blocks so far.
- **Disk cost of the toolchain:** VS Build Tools ≈ 6.7 GB · `~\.rustup` 1.28 GB · `~\.cargo` 0.5 GB · a *debug* Tauri `target/` ≈ **3.7 GB** — keep `target/` out of backups.
- **Network / proxy:** direct, no proxy. npm/crates.io/GitHub/PyPI/HuggingFace reachable.
- **Repo location:** C:\Users\Calamity\Desktop\competition-intel — **not** inside OneDrive. Dev data belongs in `%LOCALAPPDATA%\CompIntel-dev`, never in the repo.

## Standard commands
- `pnpm install --frozen-lockfile` · **`pnpm verify`** = `format:check && lint && typecheck && test`
  (~75 s here with 2371 tests; budget is < 2 min per §4.15).
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
- **`pnpm gazetteer:build`** writes `%LOCALAPPDATA%\CompIntel-dev\gazetteer\gazetteer.db` (68 MB, not
  committed, needs network). `--mini` rebuilds the committed 53 KB test fixture with no network.
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
5. Q6–Q9, Q11, Q12 open with defaults (DECISIONS.md); Q4 blocks WP-23. **Q1, Q3, Q5 closed** (Q5 → R32).
6. No BitLocker here → synthetic data only (D-33). The dev admin in `%LOCALAPPDATA%\CompIntel-dev` has
   password `pre-M1-manual-check-2026`, set out-of-band for pre-M1's GUI check.
