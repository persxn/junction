# ADR-0002: Desktop shell: Tauri 2 (vs Electron, WinUI)

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §4.0, §4.1, §3.2

## Context
The backend is a separate process anyway (ADR-0001), so the shell only needs a window, tray,
single-instance, autostart, supervision and an installer, and must stay light on 8 GB machines.

## Decision
Use **Tauri 2** (Rust) with the system **WebView2** runtime. Use its built-in tray, single-instance, autostart,
notifications, updater (Phase 2) and NSIS per-user installer. The shell stays thin.

## Consequences
- Small footprint: shell ~20–40 MB, WebView2 ~100–200 MB (*estimate*).
- Building needs the Rust + MSVC toolchain.
- WebView2 is evergreen: its version varies per machine and cannot be pinned.
- Fewer published examples of sidecar supervision than Electron.

## Alternatives considered
- **Electron:** most mature, but bundles Chromium plus its own Node (≈ +100–200 MB RAM, ~100 MB
  installer) with a different Node ABI from the standalone backend (two native-module builds).
- **WinUI 3 / WPF:** native and light, but no reusable web UI for future browser access, and a slower path to a
  polished custom UI.
