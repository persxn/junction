# Progress — newest first, keep < 150 lines

## Current
- **Next WP: WP-04b** (SQLite + Drizzle + migration runner). Nothing blocks it; the shutdown registry is ready for the DB hook.
- Spec: docs/ARCHITECTURE.md **v1.1.1 — ACCEPTED** (changelog at the top; rulings index §21 incl. R1–R10; roadmap §19 = 46 WPs, 7 done, 39 remaining).
- ADR-0001…0018 Accepted (several amended). Decisions register: docs/DECISIONS.md (D-01…D-33, Q1…Q13, user actions U1…U6).

## Environment facts
- **OS / CPU / RAM / GPU:** Windows 11 **Home** 25H2 (build 26200.9457) · AMD Ryzen 7 5700, 8c/16t · 16 GB RAM ·
  NVIDIA RTX 4060 8 GB · no NPU · **C: 42 GB free of 119 GB** (single fixed drive; was 52 GB before the toolchain).
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
- Backend: `pnpm --filter @compintel/backend dev` (tsx watch, `--dev`) · `start` · `bundle` (esbuild → `dist-bundle/`)
  · `smoke:bundle`. Root `pnpm audit:deps` (network, R4) is **outside** verify.
- **Windows has no POSIX signals**: `child.kill('SIGTERM')` hard-terminates. The shell's real lifeline is
  stdin EOF (`--stdin-lifeline`) plus the Job Object; `fetch()` also silently drops a caller-set `Host` header,
  so Host-allowlist tests must use `node:http`.
- Rust/Tauri build: `pnpm tauri build --debug --no-bundle` (add `--no-bundle` whenever the installer isn't wanted).
- **PATH caveat:** rustup added `%USERPROFILE%\.cargo\bin` to the *user* PATH; already-open terminals must be
  restarted or prepend it manually, otherwise `cargo`/`rustc` are not found.
- **NodeNext:** relative imports need a `.js` extension even in `.ts` sources.
- `npm i -g` now warns about unrun install scripts (npm 11.17 `allow-scripts` gate) — harmless for pnpm's shim.

## Completed
- **WP-04a — backend app factory** (this WP). `apps/backend`: zod config (flags > env > defaults, `--data-dir`,
  `PORT`, `--dev`, `--stdin-lifeline`, dirs `data/logs/tmp/backups-local` created + write-probed), pino via
  `multistream` → in-house daily-rotating file (keep 14, injectable clock) + stderr in `--dev`, deep key-based
  redaction, `AppError` → RFC 9457 `problem+json` (R5) with `X-Request-Id` everywhere, Host + `X-CompIntel-Client`
  (`timingSafeEqual`) + `@fastify/cors` (R9), `GET /api/v1/health`, `POST /api/v1/system/shutdown`,
  `buildApp()` (no listen) + `main.ts` (READY line, signals, stdin EOF, 10 s hard timeout, empty shutdown registry).
  Deps: fastify 5.12.5, @fastify/cors 11.3.0, fastify-type-provider-zod 7.0.0, pino 10.3.1, zod 4.6.5,
  tsx 4.23.13, esbuild 0.28.2 (needs `allowBuilds`). `pnpm verify` 217 tests green (7 s); `smoke:bundle` passes
  (2.2 MB `dist-bundle/main.mjs`); `pnpm audit:deps` clean. Rulings R1–R10 recorded in §21 (spec v1.1.1).
- **WP-03b — monorepo scaffold + `pnpm verify`**. pnpm workspace (`apps/*`, `packages/*`, `tools/*`),
  `packageManager` pnpm@12.4.2, engines `>=24.19 <25`, `.npmrc` save-exact + engine-strict, `onlyBuiltDependencies: []`
  (nothing in the tree needs install scripts). **TypeScript 6.0.3** — not 7.0.2, because typescript-eslint 8.70.0
  supports `>=4.8.4 <6.1.0`. ESLint 10.11.0 flat config (recommended+stylistic TypeChecked, `no-explicit-any`,
  `no-floating-promises`, `consistent-type-imports` as errors), Prettier 3.9.8 (`docs/` and CLAUDE.md excluded),
  Vitest 5.0.1, one root config. `packages/contracts` (zod 4.6.5): API_VERSION, the 5 spec enums, RFC 9457
  ProblemDetails + ErrorCode, 57 tests. `apps/backend`: `describeBuild()` via `workspace:*`.
  Verified green from a fresh `git clone` + `--frozen-lockfile`; injected lint/type/test faults each exit 1.
- **WP-03a — toolchain install + build probes.** Prerequisites re-verified (SAC=0, LongPaths=1).
  Installed VS Build Tools 2022 (C++ workload, ~10 min), rustup + stable-msvc, pnpm 12.4.2.
  **Probe A passed**: better-sqlite3 13.0.3 → SQLite **3.53.4**, WAL, FTS5 `porter` + `tokenize='trigram'` both
  MATCHing, JS `haversine()` called from SQL, `db.backup()` 4.1 ms, `VACUUM INTO` 2.9 ms, both copies verified;
  @node-rs/argon2 2.2.1 argon2id m=19456/t=2/p=1 → **12.8 ms per hash**, 12.3 ms per verify. Prebuilds only — no
  compiler needed (4 s install). `process.versions.sqlite` = 3.53.3 (Node's own, unused).
  **Probe B passed**: Tauri 2 vanilla-ts hello world built in **2m 13s** cold (471 crates), 12.4 MB debug exe,
  window opened and closed cleanly, no SAC/Defender block. Probe folder deleted; repo has docs changes only.
- **Architect review of WP-00…WP-02b → spec v1.1** (commit d781885, docs only, delivered by the user).
  All WP-01 findings and WP-02 questions ruled on (§21); `docs/requirements/master-requirements.md` supplied.
- **WP-00 — environment recon & bootstrap** (d159c78). Repo, .gitignore, docs/ tree; system/toolchain report;
  13 platform robots.txt in docs/research/robots/.
- **WP-01 — spec install, ADRs, engineering review** (6955690). ARCHITECTURE.md committed verbatim; §20 split into
  ADR-0001…0015; DECISIONS.md created; docs/handoff/WP-01-review.md holds 10 ranked findings, 20 ambiguities and
  S/M/L sizes for every WP with suggested splits (WP-04, 05, 07, 08, 09, 15, 16, 20, 25, 27).
- **WP-02 — source feasibility & compliance** (58f7f4f). **CTFtime APPROVED_WITH_LIMITS** (API only, Crawl-delay 10,
  30 min cadence per D-27) · **CLIST APPROVED_WITH_LIMITS but blocked** on a human account + API key ·
  **Devfolio APPROVED_WITH_LIMITS** (ToS silent → permission email, drop participant PII) ·
  **Devpost MANUAL_IMPORT_ONLY** (ToS forbids scraping — conflicts with roadmap WP-12) ·
  **Unstop MANUAL_IMPORT_ONLY** until a human reads its JS-only Terms · **117 college sites PENDING_REVIEW**.
  Sanitized fixtures for CTFtime + Devfolio only. Matrix: docs/research/source-feasibility.md.
- **WP-02b — fresh-session housekeeping** (7b61c80, ef8bd55). CLAUDE.md fresh-session rules; this file created.

## Open issues
All WP-01/WP-02 findings are ruled on in ARCHITECTURE.md §21. Still open:
1. ~~U1/U2~~ **done in WP-03a.** **U3** — Unstop Terms unread (blocks WP-13). **U4** — CLIST API key (blocks live WP-11 runs).
2. **Pilot host unknown** (Q2/Q10): check its SAC/WDAC state and disk encryption before WP-31.
3. **No 8 GB test machine**: needed for WP-31/32 (real laptop or VirtualBox VM).
4. **Disk headroom**: ~42 GB free. A full monorepo with several Rust targets plus models will eat it; watch this from WP-04a on.
5. Q1, Q3–Q9, Q11, Q12 open with defaults (DECISIONS.md); Q4 blocks WP-23.
6. No BitLocker here → synthetic data only (D-33).
