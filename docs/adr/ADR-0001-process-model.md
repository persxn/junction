# ADR-0001: Process model: thin shell + backend service + LLM sidecar over an HTTP API

- **Status:** Accepted (spec v1.1, 2026-09-20) — amended
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-01, D-02, D-05, D-14), §3.1–§3.3

## Context
The UI must never touch the DB (D-01). The pilot backend runs on one machine but must move to an
always-on campus machine without a rewrite (D-02). The core app must run on 8 GB, CPU-only, with the AI
optional (D-05). Scraping must continue while the window is closed to the tray (D-14).

## Decision
- Three processes: a thin **Tauri shell** (window, tray, supervision), a **Node backend** (all business
  logic, DB, scraping, LLM access) and an on-demand **llama-server** sidecar.
- The UI talks to the backend only via versioned HTTP/JSON `/api/v1` + SSE on `127.0.0.1:<port>` with a
  per-launch client secret. Tauri IPC is only for shell concerns (window/tray, open URL, pick/check/reveal a local path).
- The backend runs standalone (`node backend/main.js --data-dir <dir>`), independent of the shell.
- Lifecycle: spawn with `PORT=0` → READY JSON line on stdout → shell hands base URL + secret to the UI.
  Crash → restart with exponential backoff (1 s … 60 s); 5 crashes in 10 min → "background service
  stopped" screen. "Exit completely" → `POST /system/shutdown` → wait ≤ 10 s → kill tree. Children live in
  a Windows Job Object. The backend exits if its parent disappears.
- Layering: routes → application services (policy, transactions, audit) → pure domain logic →
  repositories/clients.
- Deployment modes: host mode (MVP) and client mode later over LAN + TLS, using the same backend build.

## Consequences
- A clean path to server mode and browser clients. The backend is integration-testable without the shell.
- An LLM crash or OOM cannot take down scraping or the API.
- Cost: supervision code, a READY handshake, Job Object handling, and more API boilerplate than IPC.
- Verify early (WP-05): WebView2 → loopback API (CORS, Chromium Local Network Access). Fallback: Tauri HTTP plugin.

## Alternatives considered
- UI talking to the DB, or business logic in the shell via IPC: rejected by D-01/D-02.
- In-process LLM (node-llama-cpp): a native crash would kill the backend (see ADR-0009).

## Amendments (v1.1)
- New client secret for **every backend spawn**; header `X-CompIntel-Client`; session in `Authorization: Bearer`; Tauri command `backend_connection()` → `{baseUrl, clientSecret, generation}` (§3.2).
- Backend is spawned with `std::process::Command`; the shell creates the Job Object itself (`windows` crate, KILL_ON_JOB_CLOSE) because Tauri has no kill-tree.
- Orphan detection by **stdin EOF**, Job Object as the hard guarantee.
- CORS allowlist `http://tauri.localhost` + `http://localhost:5173`; Host allowlist `127.0.0.1:<port>`, `localhost:<port>`; LNA-flag test in WP-05b.
- Packaged layout fixed in §3.2 (`resources\node`, `resources\backend`, `resources\llama`).
