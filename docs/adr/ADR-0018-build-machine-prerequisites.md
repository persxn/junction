# ADR-0018: Build-machine prerequisites — Smart App Control off, long paths, synthetic data only

- **Status:** Accepted (spec v1.1, 2026-09-20) — depends on user actions U1 and U2
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-33), §2.1 (U1, U2, U6), §5, §18; WP-00, WP-01 review finding 1/2/10, WP-02b

## Context
The build machine (Windows 11 Home 25H2, Ryzen 7 5700, 16 GB, RTX 4060 8 GB) had Smart App Control ON,
which blocks unsigned executables without reputation — including the build-script executables Cargo
creates on every build, the unsigned Tauri dev binary and llama.cpp binaries. Windows long paths were
disabled. There is no BitLocker (Home edition) and no Hyper-V.

## Decision
- **Smart App Control is turned off on the build machine** (U1). Microsoft Defender antivirus stays on.
  Since the April 2026 update SAC can be turned back on later without reinstalling Windows.
- **Windows long paths enabled** (`LongPathsEnabled=1`, admin, restart) plus repo-local
  `core.longpaths=true` (U2).
- Toolchain: Visual Studio Build Tools with the C++ workload, rustup + stable Rust (exact version pinned
  in `rust-toolchain.toml`), pnpm (pinned via `packageManager`), Node 24 LTS (already present).
- **Synthetic data only** on this machine (D-33). Real student data only on encrypted hosts.
- No Defender exclusions by default (U6 optional).
- 8 GB CPU-only validation happens on a separate 8 GB laptop or a VirtualBox VM before the pilot.

## Consequences
- Development can proceed with unsigned local builds.
- Pilot hosts must be checked for SAC/WDAC and disk encryption (Q2, Q10); if SAC must stay on there,
  every shipped binary needs a code-signing certificate.

## Alternatives considered
- Keep SAC on and avoid Rust (e.g. Electron): the packaged app itself would still be unsigned and blocked.
- Build on another machine: none available.
