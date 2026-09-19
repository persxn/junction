# WP-01 — Engineering review of ARCHITECTURE.md v1.0-draft

Reviewer: implementation engineer (Claude Code) · Date: 2026-09-20 · Machine: DESKTOP-HK22API (the build machine; see WP-00)
Scope: findings only. The spec is **not** edited. Library facts were checked on 2026-09-20 against npm, GitHub and the vendors' docs (linked).

---

## Top 10 findings (ranked)

| # | Severity | Finding | Spec § | Proposed action (architect decides) |
|---|---|---|---|---|
| 1 | **BLOCKER** | **Smart App Control is ON on this machine** (`VerifiedAndReputablePolicyState=1`, `SAC_PreviousState=2`, meaning it recently left evaluation mode). SAC blocks unsigned code with no reputation. That covers Cargo `build-script-build.exe` files (new per build), the unsigned Tauri dev exe, and unsigned `llama-server.exe`. `cargo.exe` 1.97.1 itself was reported blocked ([rust#160163](https://github.com/rust-lang/rust/issues/160163), open). Unsigned prebuilt `.node` DLLs (better-sqlite3, argon2) are **unverified** and may also be blocked. | §4.1, §4.10, §18, WP-05, WP-26 | Decide: turn SAC off on the build machine (toggleable since Apr 2026 per §18), or build on another machine. The same issue applies to any pilot host with SAC on (Q2/Q10). Suggest a 10-minute probe early in WP-03: load better-sqlite3 + argon2 prebuilds and run a `cargo build` of a hello-world with a build script. |
| 2 | HIGH | **Toolchain for M0 is missing.** No Rust/rustup, no VS Build Tools (MSVC + Windows SDK, needs admin and ~6–8 GB), no pnpm. Git was installed in this WP with user approval. | §4.1, §4.15, WP-03/05 | Add a "toolchain setup" step (WP-03a) with explicit install approval: rustup (pin a Rust version SAC doesn't block), VS 2022 Build Tools C++ workload, pnpm via corepack (bundled with Node 24.19). |
| 3 | HIGH | **SSE vs auth headers.** The browser `EventSource` API cannot send custom headers, so the per-launch client secret and bearer session token (§4.12, §10.3) can't be attached to `/api/v1/stream`. | §4.4, §4.12, §10.3 | Choose: fetch-based SSE reader (small new dependency or ~80 lines of own code), a short-lived single-use stream ticket in the query string, or cookies (conflicts with "token in memory only"). |
| 4 | HIGH | **Pre-migration backup is circular.** WP-04 must run migrations with a `PRE_MIGRATION` backup, but the age key pair is created by the WP-07 setup wizard and the encrypted pipeline arrives in WP-28. The very first migration runs before any key exists. | §4.6, §14, WP-04/07/28 | Decide: before keys exist, a PRE_MIGRATION backup is a plain `VACUUM INTO` copy inside the data dir (never exported), or skipped when the DB is empty. |
| 5 | HIGH | **FTS5 trigram doesn't handle typos.** The trigram tokenizer gives substring/LIKE/GLOB matching only. It has no edit-distance tolerance, and queries under 3 characters don't use it. §8.2 says it covers "substrings and typos". | §8.2, §4.7 | Treat typo tolerance as a separate feature: trigram-overlap scoring in the domain layer over candidate titles, or alias-only. Update the §8.2 wording or AC. |
| 6 | MEDIUM | **Drizzle can't model FTS5 virtual tables or triggers** (the schema builder has no virtual tables: [drizzle-orm#2046](https://github.com/drizzle-team/drizzle-orm/issues/2046)). FTS tables, their sync triggers and the append-only audit triggers must be raw-SQL custom migrations (`drizzle-kit generate --custom`). `drizzle-kit push` would clobber virtual tables and must never be used. | §4.6, §6.2, §8 | Add to WP-04/08 AC: "custom SQL migrations for FTS5 and triggers; `push` disabled; migration tests assert that triggers exist." |
| 7 | MEDIUM | **Tauri has no built-in Job Object / kill-tree** for sidecars ([tauri#14360](https://github.com/tauri-apps/tauri/issues/14360), [plugins-workspace#3062](https://github.com/tauri-apps/plugins-workspace/issues/3062)). The shell must create a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` itself (the `windows` crate or `process-wrap`). Also, NSIS may **not replace an `externalBin` sidecar on reinstall** when it lacks a version resource ([tauri#15134](https://github.com/tauri-apps/tauri/issues/15134)). That matters for `llama-server.exe` and future upgrades. | §3.2, §4.13, WP-05, WP-31 | Budget Job Object code in WP-05 (children of node, including llama-server, inherit the job). Add an "upgrade replaces all binaries" check to WP-31 AC. |
| 8 | MEDIUM | **llama-server JSON-schema constraints can fail open.** If grammar parsing fails, the server logs an error and **generates unconstrained, returning 200 OK** ([llama.cpp#19051](https://github.com/ggml-org/llama.cpp/issues/19051)). Unsupported schema features are skipped silently ([grammars README](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)). PCRE shorthands (`\d`, `\w`) in `pattern` break conversion ([#22314](https://github.com/ggml-org/llama.cpp/issues/22314)). Chat-template control tokens can conflict with the grammar on Qwen3/Granite ([#29006](https://github.com/ggml-org/llama.cpp/issues/29006)). The §9.4 claim of a "0 expected" invalid-output rate therefore depends on the release. | §4.10, §9.2, §9.4 | Keep zod validation of every plan (the spec already does). Keep planner schemas simple (no regex `pattern`, closed objects). Add a startup self-test against the pinned release. Put per-model chat-template checks into WP-26. |
| 9 | MEDIUM | **WebView2 Local Network Access.** LNA covers loopback. In WebView2 it is currently **off (flag-gated) since runtime 145**, with an opt-in flag `msWebViewAllowLocalNetworkAccessChecks`, and future enablement is "dependent on upstream" ([WebView2Announcements#126](https://github.com/MicrosoftEdge/WebView2Announcements/issues/126)). This machine runs WebView2 153. Default-on in a future runtime could block or prompt the UI's `fetch` from `http://tauri.localhost` to `127.0.0.1`. | §3.2, WP-05 | The WP-05 test should run once with `--enable-features=LocalNetworkAccessChecks,msWebViewAllowLocalNetworkAccessChecks` (Tauri `additionalBrowserArgs`) to prove the fallback path (Tauri HTTP plugin) works. |
| 10 | MEDIUM | **No disk encryption on this machine.** Windows 11 **Home**: the `System.Volume.BitLockerProtection` property reports 0 (no protection) on C:, and `Get-BitLockerVolume` needs admin. §14 relies on BitLocker/Device Encryption for data at rest. | §14, §15 | Don't put real student data on this build machine (use synthetic seeds). The WP-30 health check must handle Home editions: it can't use the BitLocker cmdlet without admin, so use the Shell property instead. |

---

## a. Feasibility and risks on this machine

| Area | Status | Notes |
|---|---|---|
| OS | Windows 11 **Home** 25H2 (26200) | No AppLocker module (`Get-AppLockerPolicy` not present on Home). The Home edition matters for BitLocker (finding 10). |
| Smart App Control | **ON** | See finding 1. Blocks unsigned code without reputation, including Rust build output and llama.cpp binaries. |
| WDAC / CI policies | 8 active `.cip` policies in `CodeIntegrity\CiPolicies\Active`; `CodeIntegrityPolicyEnforcementStatus=2` and `UsermodeCodeIntegrityPolicyEnforcementStatus=2` (enforced) | Consistent with SAC plus the Microsoft-supplied policies, not an enterprise policy (not domain-joined). The CI log shows only protected-process DLL rejections (OBS hook, nvspcap64) and no SAC blocks of dev tools yet. |
| AppLocker | Cmdlet unavailable (Home); AppIDSvc running | No AppLocker policy is possible on Home. |
| BitLocker | C: protection = 0 (off / not capable) | Finding 10. |
| Defender | Real-time ON, tamper protection ON, Normal mode | Expect scans of `node_modules` and the Rust `target/` folder to slow builds. Adding a Defender exclusion for the repo/target dir needs admin and is the user's decision. |
| Edge | 153.0.4234.32 at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` | Fine for `playwright-core` `channel: 'msedge'`. |
| Toolchain | Node 24.19.0, npm 11.17, Python 3.13, Git 2.55 (installed this WP) | Missing Rust, MSVC Build Tools and pnpm (finding 2). undici 8.x needs Node ≥ 22.19, which is met. |
| Disk | 52 GB free of 119 GB | Rough need: VS Build Tools 6–8 GB, Rust 1.5–2 GB, Tauri `target/` 3–5 GB, node_modules ~1 GB, models 2.5–6 GB (+1 GB CUDA build) ≈ 15–23 GB. Workable but leaves ~30 GB. Keep models outside the repo. |
| RAM / GPU | 16 GB, RTX 4060 8 GB | This dev box is the **GPU tier**, not the 8 GB target. The WP-15 perf budget ("8 GB host") and WP-31 clean-install AC need an 8 GB VM or a separate machine. Hyper-V is not available on Home. |
| Network / proxy | Direct, no proxy | npm, GitHub, PyPI and Hugging Face reachable (WP-00). |
| Permissions | User is a local admin (UAC, not elevated) | VS Build Tools install and Defender exclusions possible with UAC consent. The per-user NSIS install needs no admin. |

## b. Library and version concerns (checked 2026-09-20)

| Library | Current | Findings | Links |
|---|---|---|---|
| **Tauri 2** (`@tauri-apps/cli`) | 2.11.4 (2026-09-15) | Tray, single-instance and autostart are official plugins. NSIS per-user (`installMode: currentUser`) is supported, and the WebView2 bootstrapper modes are documented. **No Job Object / kill-tree for sidecars** (finding 7). The sidecar may not be replaced on reinstall. `externalBin` needs target-triple-suffixed names (`node-x86_64-pc-windows-msvc.exe`) and resolves relative to `src-tauri/`. Spawning `node.exe backend.js` works via the shell plugin sidecar or `std::process::Command`; the latter is simpler for Job Object control. | [Windows installer docs](https://v2.tauri.app/distribute/windows-installer/), [Node sidecar guide](https://v2.tauri.app/learn/sidecar-nodejs/), [tauri#14360](https://github.com/tauri-apps/tauri/issues/14360), [tauri#15134](https://github.com/tauri-apps/tauri/issues/15134), [discussion #3273](https://github.com/orgs/tauri-apps/discussions/3273) |
| **WebView2 → 127.0.0.1** | Runtime 153 | LNA off by default (flag-gated since 145), future default-on possible (finding 9). CORS: on Windows the Tauri 2 origin is `http://tauri.localhost` by default (`https://tauri.localhost` if `useHttpsScheme`), and in dev it is the Vite origin. The CORS allowlist in §10.3 must include both, and the Host allowlist must include `127.0.0.1:<port>`. | [WebView2Announcements#126](https://github.com/MicrosoftEdge/WebView2Announcements/issues/126), [Chromium 142 LNA FAQ](https://www.dynamsoft.com/web-twain/docs/faq/chromium-142-local-network-access-issue.html) |
| **better-sqlite3** | 13.0.3 (2026-08-05), `engines.node >= 22` | **Good news:** 13.x is built on **N-API**, and the npm tarball ships `prebuilds/win32-x64.node` (and 7 other platforms). There is no install script, so no compiler is needed and it works with pnpm `onlyBuiltDependencies`. The older Node 24 prebuild gaps ([#1384](https://github.com/WiseLibs/better-sqlite3/issues/1384)) no longer apply. Bundled **SQLite 3.53.4** with `SQLITE_ENABLE_FTS5`, so the trigram tokenizer (≥ 3.34) is available. Risks: the unsigned `.node` under SAC (finding 1), and esbuild bundling must copy `prebuilds/`. | [releases](https://github.com/WiseLibs/better-sqlite3/releases), [compilation.md @v13.0.3](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/compilation.md) |
| **Drizzle** | drizzle-orm 0.45.2 / drizzle-kit 0.31.10 (2026-09-09) | No virtual-table support, so FTS5, triggers and the audit append-only triggers must be custom SQL migrations (finding 6). Still 0.x, so pin exact versions. | [drizzle-orm#2046](https://github.com/drizzle-team/drizzle-orm/issues/2046), [custom migrations](https://orm.drizzle.team/docs/sqlite/drizzle-kit-generate), [trigger gist](https://gist.github.com/HugeLetters/7cce16a0f57b612507c7e17a9b4e688e) |
| **@node-rs/argon2** | 2.2.1 (2026-09-10) | Prebuilt `@node-rs/argon2-win32-x64-msvc` optional dependency (N-API), so no compiler needed. Unsigned `.node` under SAC (finding 1). | [npm](https://www.npmjs.com/package/@node-rs/argon2), [win32 package](https://www.npmjs.com/package/@node-rs/argon2-win32-x64-msvc) |
| **age-encryption** (typage) | 0.3.1 (2026-08-28) | ESM-only, Node 20+, uses WebCrypto. Supports X25519, scrypt passphrases (adjustable work factor) and streaming, so large DB backups needn't sit in memory. Pre-1.0: pin the exact version, and keep interop tests with the `age` CLI (§14 promises CLI decryptability). | [typage](https://github.com/FiloSottile/typage) |
| **playwright-core** `channel: 'msedge'` | 1.63.0 (2026-09-19) | Supports installed Edge Stable/Beta with the new headless mode. Each Playwright release is tested against a specific Chromium, and evergreen Edge can run ahead of it, so pin Playwright, run the smoke test in WP-09/12, and pause the adapter on launch failure. Note `@playwright/test` (E2E, §4.15) downloads browsers unless configured for `msedge`. | [Playwright browsers](https://playwright.dev/docs/browsers), [MS Learn](https://learn.microsoft.com/en-us/microsoft-edge/playwright/) |
| **llama.cpp llama-server** | fast-moving; pin a build | `response_format` json_schema and `/completion` `json_schema` are supported, but fail-open and feature gaps exist (finding 8). The README says to see the tests for supported features. Windows binaries are unsigned (SAC, §18). | [server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [#19051](https://github.com/ggml-org/llama.cpp/issues/19051), [#22314](https://github.com/ggml-org/llama.cpp/issues/22314), [#29006](https://github.com/ggml-org/llama.cpp/issues/29006) |
| Others noted | fastify 5.12.5, undici 8.10.2 (Node ≥ 22.19) | OK with Node 24.19. | npm registry |

## c. Ambiguities that would force guessing

1. **§4.4 / §10.3 / §4.12:** SSE authentication (finding 3).
2. **§3.2 client secret:** "random per launch", but per *shell* launch or per *backend spawn*? After a crash-restart, does the UI receive a new secret? And what is the header name?
3. **§10.3 CORS origins:** the exact Tauri origin (`http://tauri.localhost` vs `https://…`, i.e. the `useHttpsScheme` choice) and the dev origin (Vite port) aren't specified.
4. **§4.6 / §14:** PRE_MIGRATION backup before backup keys exist (finding 4).
5. **§8.2:** "trigram … for typos" (finding 5). What typo tolerance is required, and is there an AC?
6. **§8.1:** `teamSizeFits` comment says "unless includeUnknown", but the field is `includeUnknownFields`. Is one flag meant to govern unknown fee, team size, distance and dates together? Also, `maxDistanceKm` is "offline/hybrid only": are ONLINE events included or excluded when a distance filter is set?
7. **§8.1 date strings:** `deadlineFrom/To`, `eventDate.from/to`: ISO date or datetime? Interpreted in IST or UTC? Inclusive end-of-day?
8. **§7.6 "complete listing run":** undefined. With "max requests per run" (§7.2), a paginated source might never complete, so MISSING would never trigger, or would trigger falsely.
9. **§7.2 vs robots Crawl-delay:** CTFtime asks for `Crawl-delay: 10` but the default minimum delay is 3 s. Does robots `Crawl-delay` override the per-host delay when it's larger?
10. **§7.2 User-Agent contact email:** which settings key holds it, and what UA is used before the setup wizard has run?
11. **§7.5 `edition_year`:** derived from the title, from the start date, or both, and which wins when they disagree? It gates merging, so it matters.
12. **§11 progress:** a stage with tasks marked COMPLETED while tasks are still open: which drives progress? And a SKIPPED stage that has tasks?
13. **§10.2 "Deactivate a student: the student's mentors":** mentors via `mentorships`, via `team_mentors` of the student's teams, or both?
14. **§6.2 engagements:** the uniqueness rule for INDIVIDUAL engagements (the UQ only covers team_id). Can the same student be assigned the same event twice?
15. **§14 schedule time:** is 13:00 in machine-local time or the IST display setting? They differ in server mode off-IST.
16. **§6.1 UUIDv7:** needs a library (Node's `crypto` has only `randomUUID` v4). Is a new dependency OK, or should we hand-write it (~20 lines)?
17. **§3.2 orphan protection:** how the backend detects parent death on Windows (poll `process.ppid` liveness vs a stdin-pipe EOF). Stdin EOF is more robust and matches the Job Object approach.
18. **§4.10 first-run micro-benchmark** (choosing CPU/Vulkan/CUDA): which WP implements it, 26 or 27?
19. **§4.14 `/system/client-log`:** does it need a session? (UI errors can occur before login.) If not, what rate limit applies?
20. **§3.4 vs §3.2:** the repo path is `apps/backend` but the runtime command is `node backend/main.js`. Presumably the packaged layout; please confirm the packaged directory structure.

## d. WP sizes (S ≤ 1 day, M 1–2 days, L > 2 days) and suggested splits

| WP | Size | Split? |
|---|---|---|
| WP-00 | S | done |
| WP-01 | M | done (this) |
| WP-02 | M | — |
| WP-03 | M | **Split:** 03a toolchain install + SAC probe (finding 1/2); 03b monorepo scaffold + verify. |
| WP-04 | L | **Split:** 04a app factory, config, logging + rotation, problem+json, /health; 04b SQLite + Drizzle + custom-SQL migration path + pre-migration copy; 04c job runner (heavily tested). |
| WP-05 | L | **Split:** 05a spawn, READY handshake, Job Object, restart/backoff, shutdown; 05b tray, close-to-tray, single instance, autostart, loopback/LNA check. |
| WP-06 | M | — |
| WP-07 | L | **Split:** 07a auth core (accounts, Argon2id, sessions, lockout, auto-lock) + policy module + audit hash chain; 07b setup wizard (incl. age key generation) + user admin UI. |
| WP-08 | L | **Split:** 08a event schema + normalization library (≥ 100 cases); 08b gazetteer build + institutions seed + geocoder + distance + geography policy. |
| WP-09 | L | **Split:** 09a PoliteHttpClient + runs/state + scheduler jobs + snapshots (failure-mode tests); 09b CTFtime adapter. |
| WP-10 | L | Keep, but expect 2+ days (merge/unmerge + field resolution + change detection). |
| WP-11 | M | — |
| WP-12 | M | — |
| WP-13 | S–M | Depends on WP-02 (S if manual-import only). |
| WP-14 | M | — |
| WP-15 | L | **Split:** 15a EventQuery + query builder + FTS/trigram + aliases + perf test; 15b category rules engine + facets + ranking + relevance reasons. |
| WP-16 | L | **Split:** 16a feed tabs, filters, cards, watchlist/hide; 16b detail drawer (provenance, conflicts, history) + freshness pill + source status + category override. |
| WP-17 | M–L | Keep; the CSV/XLSX import with a preview is the heavy part. |
| WP-18 | M | — |
| WP-19 | M | — |
| WP-20 | L | **Split:** 20a templates, copy-on-assign, stages, tasks, progress & health; 20b resources + open allowlist (shell-side path checks). |
| WP-21 | M | — |
| WP-22 | M | — |
| WP-23 | M–L | Blocked on Q4. |
| WP-24 | M | — |
| WP-25 | L | **Split:** 25a deterministic parser + chips; 25b eval dataset (≥ 120) + harness. |
| WP-26 | M | Depends on finding 1 (SAC vs unsigned llama.cpp). |
| WP-27 | L | **Split:** 27a supervisor + planner + entity resolution + fallbacks; 27b grounded summaries + validator + Assistant UI + query log. |
| WP-28 | M | — |
| WP-29 | L | Keep; its compliance reviews per college site are extra research time. |
| WP-30 | M | — |
| WP-31 | L | Keep; needs an 8 GB clean machine/VM (not available: Home edition has no Hyper-V). |
| WP-32 | L | The 72 h soak is calendar time, not worker time. |

## Extra recon (WP-01 §5)

| Check | Result |
|---|---|
| Smart App Control (`VerifiedAndReputablePolicyState`) | **1 = ON** (`SAC_PreviousState=2` evaluation, `SAC_EnforcementReason=1`) |
| AppLocker (`Get-AppLockerPolicy -Effective`) | Cmdlet not available (Windows 11 Home has no AppLocker module); AppIDSvc running |
| WDAC / CI policies | 8 active `.cip` files; DeviceGuard reports CI + user-mode CI enforcement = 2 (enforced); VBS = 0 |
| BitLocker | `Get-BitLockerVolume`: **not permitted** (needs admin). Shell property `System.Volume.BitLockerProtection` on C: = 0 (no protection). Only one fixed drive (C:) |
| Defender real-time | ON (AMService on, tamper protection on, Normal mode) |
| Microsoft Edge | Installed: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 153.0.4234.32 |
