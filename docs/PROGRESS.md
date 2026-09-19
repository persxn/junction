# Progress — newest first, keep < 150 lines

## Current
- **Next WP: WP-03a** (toolchain + probes), then WP-03b (monorepo scaffold). Both need a fresh session.
- **Before WP-03a the user must do U1 (Smart App Control off) and U2 (approve installs, enable long paths).**
- Spec: docs/ARCHITECTURE.md **v1.1 — ACCEPTED** (changelog at the top; rulings index §21; roadmap §19 = 46 WPs, 42 remaining).
- ADR-0001…0015 Accepted (several amended), new ADR-0016 (sources), ADR-0017 (connection security/SSE), ADR-0018 (build-machine prerequisites).
- Decisions register: docs/DECISIONS.md (D-01…D-33, Q1…Q13, user actions U1…U6).

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
- **Architect review of WP-00…WP-02b → spec v1.1** (docs only, delivered by the user). All WP-01 findings/ambiguities and WP-02 questions ruled on (§21). `docs/requirements/master-requirements.md` supplied.
- **WP-00 — environment recon & bootstrap** (commit d159c78). Repo, .gitignore, docs/ tree; full system/toolchain report;
  13 platform robots.txt saved to docs/research/robots/. Git was missing and was installed later (user-approved) to allow commits.
  `docs/requirements/master-requirements.md` was a placeholder; **now supplied by the architect (v1.1 package)**. ARCHITECTURE.md remains the source of truth.
- **WP-01 — spec install, ADRs, engineering review** (commit 6955690). ARCHITECTURE.md committed verbatim; §20 split into
  ADR-0001…ADR-0015 (Proposed); DECISIONS.md created; docs/handoff/WP-01-review.md holds 10 ranked findings, library version
  checks (better-sqlite3 13.0.3 ships N-API win32-x64 prebuilds + SQLite 3.53.4 with FTS5 → no compiler needed), 20 ambiguities
  and S/M/L sizes for every WP with suggested splits (WP-04, 05, 07, 08, 09, 15, 16, 20, 25, 27).
- **WP-02 — source feasibility & compliance** (commit 58f7f4f). Verdicts: **CTFtime APPROVED_WITH_LIMITS** (API only, Crawl-delay 10,
  cadence 60 min proposed → 30 min per D-27, no clone, ai-train=no) · **CLIST APPROVED_WITH_LIMITS but blocked** until a human creates an account + API key
  (10 req/min, attribution, no redistribution) · **Devfolio APPROVED_WITH_LIMITS** (server-rendered Next.js JSON, ToS silent →
  send permission email, drop participant PII) · **Devpost MANUAL_IMPORT_ONLY** (ToS explicitly forbids scraping — conflicts with
  roadmap WP-12) · **Unstop MANUAL_IMPORT_ONLY** until a human reads its JS-only Terms · **117 college sites PENDING_REVIEW**.
  Sanitized fixtures exist for CTFtime + Devfolio only. Full matrix: docs/research/source-feasibility.md.
- **WP-02b — fresh-session housekeeping** (this WP). CLAUDE.md replaced with the fresh-session rules; this file created;
  stale repo-path references removed; `core.longpaths=true` set; OneDrive/long-path/Defender checks recorded above.

## Open issues
All WP-01/WP-02 findings are ruled on in ARCHITECTURE.md §21. Still open:
1. **U1/U2** — Smart App Control off + toolchain approval + long paths (blocks WP-03a).
2. **U3** — Unstop Terms unread (blocks WP-13). **U4** — CLIST API key (blocks live WP-11 runs).
3. **Pilot host unknown** (Q2/Q10): check its SAC/WDAC state and disk encryption before WP-31.
4. **No 8 GB test machine**: needed for WP-31/32 (real laptop or VirtualBox VM).
5. Q1, Q3–Q9, Q11, Q12 open with defaults (DECISIONS.md); Q4 blocks WP-23.
6. No BitLocker here → synthetic data only (D-33).
