=== WORKER REPORT: WP-02b ===
Status: DONE

Summary (≤5 lines):
- Repo confirmed working at C:\Users\Calamity\Desktop\competition-intel (git top-level, clean tree, 3 prior commits).
- CLAUDE.md replaced verbatim with the fresh-session rules; docs/PROGRESS.md created (60 lines) covering WP-00…WP-02b,
  environment facts and 13 open issues; the one stale path reference (docs/handoff/WP-00.md) rewritten.
- Read-only checks done: Desktop is NOT OneDrive-redirected; OS long paths disabled; Defender exclusions need admin.
- `git config core.longpaths true` set for this repo only.

Files changed (paths only):
- CLAUDE.md
- docs/PROGRESS.md
- docs/handoff/WP-00.md
- docs/handoff/WP-02b.md
- .git/config (core.longpaths, not tracked)

Tests/commands & results:
- `git -C <repo> status/log/rev-parse` → clean, HEAD 58f7f4f, top-level = C:/Users/Calamity/Desktop/competition-intel. PASS.
- `reg query "HKCU\...\User Shell Folders" /v Desktop` → `%USERPROFILE%\Desktop` (REG_EXPAND_SZ). `$env:OneDrive` =
  C:\Users\Calamity\OneDrive; repo path is not under it → **Desktop is not synced by OneDrive**. PASS.
- `reg query HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled` → **0x0 (disabled)**.
- `Get-MpPreference` → "N/A: Must be an administrator to view exclusions" → **repo exclusion status unknown**; not changed.
- `git config core.longpaths true` → verified `core.longpaths=true` (repo-local).
- Grep for `dev\competition-intel` across CLAUDE.md + docs/ → 0 hits after the edit.

Deviations from the prompt (why):
- None. (The WP-00 reference was historical, not a live path; rewritten so no stale path remains, as instructed.)

Minor decisions made:
- PROGRESS.md "Standard commands" left as a placeholder for WP-03, plus the repo-local git identity, which is a useful fact now.
- Open issues carry the WP-01 review's 10 findings, condensed, plus the scraping-policy gaps from WP-02 and the
  still-missing master-requirements doc (13 entries total).
- This report was committed separately from the housekeeping commit, so the WP-02b commit matches the prompt's message exactly.

New dependencies (name@version — why): none.

Known issues / tech debt:
- **OS long paths are OFF (LongPathsEnabled=0).** `core.longpaths` fixes git only. pnpm's nested `node_modules`, Rust's
  `target/`, and Tauri's build output can still exceed MAX_PATH from a Desktop-rooted path. Enabling it system-wide needs
  admin + a reboot; worth deciding before WP-03.
- **Defender real-time scanning is on and its exclusions can't be read without admin.** Expect slower installs/builds
  (`node_modules`, `target/`). Any exclusion is an admin action and the user's call.
- Desktop is not OneDrive-synced, so no sync-lock risk to the SQLite dev DB — but dev data still belongs in
  `%LOCALAPPDATA%\CompIntel-dev` per the new CLAUDE.md.

Questions for the architect:
1. Enable OS-wide long paths (admin + reboot) before WP-03, or keep paths short and accept the risk?
2. Should the pilot/build machine get a Defender exclusion for the repo and `%LOCALAPPDATA%\CompIntel-dev`? (admin; affects build times only)
3. Still open from WP-01/WP-02 and unchanged: Smart App Control decision, toolchain install approval, SSE auth, Devpost/WP-12 re-scope.

Files the architect should review (≤5, most important first):
1. docs/PROGRESS.md
2. CLAUDE.md
3. docs/handoff/WP-01-review.md (the 10 findings behind the open issues)
4. docs/research/source-feasibility.md
5. docs/DECISIONS.md

Suggested next step:
Issue WP-03a (toolchain install + Smart App Control probe) with install approval; it unblocks every later WP and
answers open issue 1 before any Tauri/Rust work is scheduled.
===
