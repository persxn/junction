# Progress — newest first, keep < 150 lines

## Current
- Next WP: WP-03 (awaiting architect prompt). WP-01 suggests splitting it: **03a toolchain + SAC probe**, then 03b scaffold.
- Spec: docs/ARCHITECTURE.md v1.0-draft (PROPOSED). Decisions register: docs/DECISIONS.md (D-01…D-25 resolved, Q1…Q13 open).
- Blocking before any Tauri/LLM work: the Smart App Control decision (see Open issues 1).

## Environment facts
- **OS / CPU / RAM / GPU:** Windows 11 **Home** 25H2 (build 26200.9457) · AMD Ryzen 7 5700, 8c/16t · 16 GB RAM (~9.8 GB free) ·
  NVIDIA RTX 4060 8 GB (driver 32.0.15.9186) · no NPU · C: 52 GB free of 119 GB (single fixed drive).
  This box is the **GPU tier**, not the 8 GB target; Home edition has no Hyper-V, so there is no 8 GB test VM (affects WP-15, WP-31).
- **Toolchain:** node v24.19.0 · npm 11.17.0 · python 3.13.15 · git 2.55.0.windows.3 (machine-wide, `C:\Program Files\Git`) ·
  winget 1.29.290 · WebView2 runtime 153.0.4234.32 · Edge 153.0.4234.32 (`C:\Program Files (x86)\Microsoft\Edge\Application`).
  **Missing: pnpm (use corepack), rustup/cargo, MSVC/VS Build Tools, dotnet, pwsh 7.** Nothing else may be installed without approval.
- **Network / proxy:** direct, no proxy (WinHTTP direct, WinINet ProxyEnable=0, no HTTP(S)_PROXY). npm/GitHub/PyPI/HuggingFace reachable.
- **Smart App Control / WDAC / BitLocker:** SAC **ON** (`VerifiedAndReputablePolicyState=1`, previously evaluation) ·
  CI + user-mode CI enforcement = 2 (enforced), VBS off · AppLocker unavailable (Home) · **BitLocker: none** (C: protection = 0);
  keep real student data off this machine · Defender real-time ON + tamper protection ON (exclusions need admin to read).
- **Repo location:** C:\Users\Calamity\Desktop\competition-intel — **not** inside OneDrive (Desktop is not redirected).
  OS `LongPathsEnabled=0`; repo has `core.longpaths=true`. Dev data belongs in `%LOCALAPPDATA%\CompIntel-dev`, never in the repo.

## Standard commands
- (filled in from WP-03)
- Git identity is repo-local: `Calamity <sohomaroy2005@gmail.com>`; `core.autocrlf=false`.

## Completed
- **WP-00 — environment recon & bootstrap** (commit d159c78). Repo, .gitignore, docs/ tree; full system/toolchain report;
  13 platform robots.txt saved to docs/research/robots/. Git was missing and was installed later (user-approved) to allow commits.
  `docs/requirements/master-requirements.md` is still a **placeholder** — the doc was never supplied; ARCHITECTURE.md is the source of truth.
- **WP-01 — spec install, ADRs, engineering review** (commit 6955690). ARCHITECTURE.md committed verbatim; §20 split into
  ADR-0001…ADR-0015 (Proposed); DECISIONS.md created; docs/handoff/WP-01-review.md holds 10 ranked findings, library version
  checks (better-sqlite3 13.0.3 ships N-API win32-x64 prebuilds + SQLite 3.53.4 with FTS5 → no compiler needed), 20 ambiguities
  and S/M/L sizes for every WP with suggested splits (WP-04, 05, 07, 08, 09, 15, 16, 20, 25, 27).
- **WP-02 — source feasibility & compliance** (commit 58f7f4f). Verdicts: **CTFtime APPROVED_WITH_LIMITS** (API only, Crawl-delay 10,
  cadence 60 min, no clone, ai-train=no) · **CLIST APPROVED_WITH_LIMITS but blocked** until a human creates an account + API key
  (10 req/min, attribution, no redistribution) · **Devfolio APPROVED_WITH_LIMITS** (server-rendered Next.js JSON, ToS silent →
  send permission email, drop participant PII) · **Devpost MANUAL_IMPORT_ONLY** (ToS explicitly forbids scraping — conflicts with
  roadmap WP-12) · **Unstop MANUAL_IMPORT_ONLY** until a human reads its JS-only Terms · **117 college sites PENDING_REVIEW**.
  Sanitized fixtures exist for CTFtime + Devfolio only. Full matrix: docs/research/source-feasibility.md.
- **WP-02b — fresh-session housekeeping** (this WP). CLAUDE.md replaced with the fresh-session rules; this file created;
  stale repo-path references removed; `core.longpaths=true` set; OneDrive/long-path/Defender checks recorded above.

## Open issues
1. **Smart App Control is ON → blocks unsigned code with no reputation.** Cargo build-script exes, the unsigned Tauri dev exe and
   unsigned `llama-server.exe` are at risk (cargo.exe 1.97.1 itself was reported blocked upstream); unsigned `.node` prebuilds are
   unverified. **Decide: turn SAC off on this machine, or build elsewhere.** Probe it early in WP-03a. Same question for the pilot host (Q2/Q10).
2. **Toolchain install needs approval:** rustup (pin a Rust version SAC tolerates), VS 2022 Build Tools C++ workload (~6–8 GB, admin), pnpm via corepack.
3. **SSE auth undecided:** `EventSource` cannot send the client-secret/session headers required by §4.12/§10.3. Pick fetch-based SSE, a stream ticket, or cookies.
4. **PRE_MIGRATION backup is circular:** WP-04 needs it before the age keys exist (WP-07/WP-28). Decide: plain local copy, or skip on an empty DB.
5. **FTS5 trigram ≠ typo tolerance** (§8.2 wording/AC). Decide whether typo tolerance is in the MVP.
6. **Drizzle cannot model FTS5 virtual tables or triggers** → custom SQL migrations; `drizzle-kit push` must never be used.
7. **Tauri provides no Job Object / kill-tree** for sidecars (§3.2 requires it) and NSIS may not replace `externalBin` on reinstall.
8. **llama-server JSON-schema constraints can fail open** (grammar error → unconstrained 200 OK). Always zod-validate; keep planner schemas regex-free.
9. **WebView2 Local Network Access** is flag-gated off today but covers loopback; test WP-05 with the flag and keep the Tauri-HTTP fallback.
10. **No BitLocker on this machine** → synthetic data only; WP-30's health check must work without admin (Shell property, not the BitLocker cmdlet).
11. **Scraping policy gaps for the architect:** robots `Crawl-delay` must override the 3 s default; the 15-minute cadence is too aggressive for
    every reviewed source; adapters must strip PII at the boundary; WP-12 (Devpost) needs re-scoping; "is user-initiated URL import automated access?" is unanswered.
12. **20 spec ambiguities** listed in docs/handoff/WP-01-review.md §c (edition_year derivation, "complete listing run", stage-progress conflicts,
    EventQuery date semantics, `includeUnknownFields` naming, Tauri origin for CORS, and others) — need architect rulings before the affected WPs.
13. `docs/requirements/master-requirements.md` is a placeholder; supply it or drop it from the docs tree.
