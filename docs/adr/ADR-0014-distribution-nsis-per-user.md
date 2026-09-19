# ADR-0014: Distribution: NSIS per-user; unsigned internal pilot conditional on SAC/WDAC

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-17), §4.13, §18

## Context
Code signing is not mandatory for the pilot unless the environment requires it (D-17). Azure Artifact Signing
Public Trust is not available in India. Public code-signing certificates now last at most 460 days and need
hardware or cloud key storage. EV no longer grants instant SmartScreen reputation.

## Decision
- Tauri bundler → **NSIS installer, per-user** (no admin), with the WebView2 bootstrapper only if missing. Bundle:
  shell, UI, the official `node.exe`, the backend bundle + native modules, the llama-server CPU build (+ optional Vulkan),
  the gazetteer and seeds. The model is not bundled.
- Data directory `%LOCALAPPDATA%\CompIntel\` by default, configurable (e.g. `D:\CompIntel\`). Uninstall keeps data
  unless the user opts in.
- Pilot: **unsigned internal distribution is acceptable only if** Smart App Control is off (or in evaluation)
  and no WDAC/AppLocker policy blocks unsigned binaries. Distribute via USB/share or `Unblock-File`. Avoid
  packers. If antivirus flags a file, submit it to Microsoft as a false positive.
- Before wider rollout: use a university IT certificate or an OV certificate; sign the shell, installer and native modules;
  sign or self-build llama.cpp.
- Updates: manual installer for the pilot; the Ed25519-signed Tauri updater in Phase 2.

## Consequences
- Installer ~120–200 MB (*estimate*).
- The pilot depends on the host's SAC/WDAC state [Q2, Q10].

## Alternatives considered
- MSIX: requires signing, and sandboxing complicates child processes and data directories.
- A single-binary backend (pkg/SEA): packed executables attract antivirus false positives.
