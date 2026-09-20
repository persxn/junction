=== WORKER REPORT: WP-03a ===
Status: DONE

Summary (<=5 lines):
Committed the architect's v1.1 docs package, re-verified both build-machine prerequisites (SAC off,
long paths on), and installed the approved toolchain: VS Build Tools 2022 + C++ workload, rustup with
stable-x86_64-pc-windows-msvc, and pnpm. Both probes passed: SQLite 3.53.4 with WAL, FTS5 porter and
trigram, a JS function called from SQL, backup and VACUUM INTO; argon2id at 12.8 ms per hash; and a
Tauri 2 hello world that built cold in 2m 13s and opened its window with no SAC or Defender block.

Files changed (paths only):
docs/PROGRESS.md
docs/handoff/WP-03a.md
(plus commit d781885 = the architect's v1.1 package, delivered by the user: docs/ARCHITECTURE.md,
docs/DECISIONS.md, docs/requirements/master-requirements.md, docs/adr/ADR-0001...0015 amended,
docs/adr/ADR-0016, ADR-0017, ADR-0018 added)

Tests/commands & results:

PREREQUISITES (read-only)
  HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 0   PASS (SAC off)
  HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled               = 1   PASS

INSTALLS (exact commands)
  winget install --id Microsoft.VisualStudio.2022.BuildTools --source winget
    --accept-package-agreements --accept-source-agreements
    --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools
                --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --includeRecommended"
      -> VS Build Tools 2022 17.14.41 (installationVersion 17.14.37710.0),
         MSVC 14.44.35207, Windows 11 SDK 10.0.26100.0, link.exe present.  ~10 min, ~6.7 GB.
  winget install --id Rustlang.Rustup --source winget --accept-package-agreements --accept-source-agreements
      -> rustup 1.29.1; rustc/cargo 1.98.1; stable-x86_64-pc-windows-msvc default host and only target.  59 s.
  corepack enable        -> FAILED, EPERM on C:\Program Files\nodejs\pnpx (needs admin)
  npm i -g pnpm@12.4.2   -> pnpm 12.4.2 in %APPDATA%\npm, already on PATH.  13 s.

PROBE A  (%LOCALAPPDATA%\CompIntel-dev\probes\A, plain npm project, node v24.19.0)
  npm install (better-sqlite3@13.0.3, @node-rs/argon2@2.2.1)  -> 4 s, prebuilds only, no compiler invoked
  SQLite version              3.53.4          journal_mode  wal
  FTS5 porter MATCH           "competing" -> 1 row (stemmed)    "competition" -> 2 rows
  FTS5 trigram MATCH          "ackatho"   -> 1 row (infix)      "obotic"      -> 1 row
  haversine(lat1,lon1,lat2,lon2)  registered via db.function(), used in both SELECT and WHERE -> 4 rows by km
  db.backup()                 49152 bytes in 4.1 ms  -> reopened, 3 FTS rows + trigram hit verified
  VACUUM INTO                 49152 bytes in 2.9 ms  -> reopened, same verification
  total probe A1              31 ms
  process.versions.sqlite     3.53.3 (Node's built-in; informational only, not used)
  argon2id m=19456 KiB t=2 p=1   12.8 ms/hash, 12.3 ms/verify (mean of 10); wrong password rejected
  PASS

PROBE B  (%LOCALAPPDATA%\CompIntel-dev\probes\B)
  pnpm dlx create-tauri-app hello-tauri --template vanilla-ts --manager pnpm
       --identifier com.compintel.probe --yes    -> create-tauri-app 4.7.4, 3 s
  pnpm install                                    -> 12 s (tauri-cli 2.11.4, vite 8.3.0, typescript 6.0.3)
  pnpm tauri build --debug --no-bundle            -> exit 0 in 2m 13s cold (471 crates locked),
                                                     no compiler warnings, no errors
  hello-tauri.exe                                 -> 12.4 MB; launched 6 s, MainWindowTitle "hello-tauri",
                                                     12 msedgewebview2 children, closed cleanly via CloseMainWindow
  target/ 3.2 GB . node_modules 0.07 GB . ~\.cargo 0.5 GB . ~\.rustup 1.28 GB
  Defender detections in the window: none.  CodeIntegrity/Operational events: none.  No SAC prompt or block.
  PASS

CLEANUP
  %LOCALAPPDATA%\CompIntel-dev\probes deleted (CompIntel-dev is now empty).
  git status: only docs/ changes.  C: 42.4 GB free (was 52 GB before the toolchain).

Deviations from the prompt (why):
- The prompt said to install "the version Tauri v2's Windows prerequisites page recommends". That page
  names no version - it links to Microsoft's generic "Download Build Tools" page, which now serves the
  2026 (18.x) line. I asked the user, who chose Build Tools 2022 (17.14.41) as the toolset the
  Rust/node-gyp/Tauri ecosystem is most heavily tested against.
- `corepack enable` was tried first as instructed and failed without admin, so the npm fallback was used.
- The winget process's own wall clock reads 578 min because it was left running across a scheduled
  overnight pause. The real install duration (~10 min) comes from the VS setup logs and payload timestamps.

Minor decisions made:
- Added `--add Microsoft.VisualStudio.Component.Windows11SDK.26100` explicitly rather than relying on
  `--includeRecommended` alone, so the SDK version is pinned and recorded.
- Probe A used a plain npm project (as specified) with ESM .mjs scripts; probe B used pnpm.
- Probe A's haversine uses R = 6371.0088 km (mean Earth radius) and calls the function in both the
  projection and the WHERE clause, to prove it works in a filter and not just in output.
- argon2 timings are the mean of 10 hashes after a discarded warm-up call (13.5 ms) that loads the addon.

New dependencies (name@version - why):
None added to the repo. Probe-only, in a folder that has been deleted, outside the repo:
  better-sqlite3@13.0.3   - probe A, the DB driver ADR-0005 selects
  @node-rs/argon2@2.2.1   - probe A, the password hash ADR-0010 selects
  create-tauri-app@4.7.4, @tauri-apps/cli@2.11.4, vite@8.3.0, typescript@6.0.3 - probe B scaffold
Machine-level (approved by the prompt): VS Build Tools 2022 17.14.41, rustup 1.29.1 / Rust 1.98.1, pnpm 12.4.2.

Known issues / tech debt:
1. A *debug* Tauri target/ is 3.2 GB for a hello world. With 42 GB free and a monorepo that will hold
   several Rust targets plus GGUF models, disk is a real constraint from WP-03b on.
2. `corepack enable` needs admin here, so pnpm is a global npm install rather than corepack-managed.
   `packageManager` in package.json will still pin the version for anyone who does have corepack.
3. rustup put %USERPROFILE%\.cargo\bin on the *user* PATH; terminals opened before the install do not
   see `cargo`. Fresh sessions are fine.
4. Rust 1.98.1 is not yet pinned. ADR-0018 calls for a rust-toolchain.toml - that belongs to WP-03b.
5. cargo reported 4 dependencies held back from their latest versions (generic-array, toml,
   toml_datetime, toml_edit) by the Tauri 2 dependency graph. Cosmetic for a probe; worth a look if a
   security advisory ever lands on one of them.

Questions for the architect:
1. Pin Rust to 1.98.1 in rust-toolchain.toml in WP-03b, or track `stable`? ADR-0018 says "exact version
   pinned" - please confirm 1.98.1 is the pin.
2. VS Build Tools 2022 was chosen over the 2026 line (see Deviations). If you want the newer MSVC toolset
   for the shipped build, say so before WP-03b - switching later means another ~7 GB install.
3. Probe B's target/ size suggests a shared CARGO_TARGET_DIR outside the repo for the monorepo. Is that
   acceptable, given the rule that dev artefacts live in %LOCALAPPDATA%\CompIntel-dev?

Files the architect should review (<=5, most important first):
1. docs/handoff/WP-03a.md (this report - the measured numbers)
2. docs/PROGRESS.md (environment facts + standard commands, now authoritative)
3. docs/adr/ADR-0018-build-machine-prerequisites.md (U1/U2 are now done; the Rust pin is still open)

Suggested next step:
WP-03b - monorepo scaffold. Bring the confirmed pins with it: node 24.19.0, pnpm 12.4.2 via
`packageManager`, Rust 1.98.1 via rust-toolchain.toml, and a .gitignore that excludes target/.
===
