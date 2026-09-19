# ADR-0017: Connection security — per-spawn client secret, bearer sessions, fetch-based SSE, CORS/Host allowlists

- **Status:** Accepted (spec v1.1, 2026-09-20)
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §3.2, §4.4, §4.12, §4.14, §10.3; WP-01 review findings 3, 9 and ambiguities 1–3, 19

## Context
The UI calls a loopback HTTP API. Other local processes and web pages must not be able to use it. The
browser `EventSource` API cannot send custom headers, and the spec keeps session tokens in memory only
(no cookies).

## Decision
- The shell generates a 32-byte client secret for **every backend spawn** and passes it via env; the UI
  obtains `{baseUrl, clientSecret, generation}` from the Tauri command `backend_connection()` and calls
  it again after any network error.
- Every request carries `X-CompIntel-Client: <secret>`; authenticated requests also carry
  `Authorization: Bearer <sessionToken>`. Sessions are stored (hashed) in the DB and survive backend
  restarts.
- SSE (`/api/v1/stream`) is consumed with `fetch()` + `ReadableStream` by a small in-house client
  (reconnect with backoff, `Last-Event-ID`) sending the same headers. No tokens in URLs, no cookies.
- CORS allowlist: `http://tauri.localhost` (production, `useHttpsScheme` false) and
  `http://localhost:5173` (Vite dev, strictPort). Host allowlist: `127.0.0.1:<port>`, `localhost:<port>`.
- `/health` and `/auth/login` need only the client secret; `/system/client-log` needs the client secret,
  no session, body ≤ 8 KB, 30 requests/min.
- WebView2 Local Network Access is tested with its feature flags in WP-05b; fallback is Tauri's HTTP plugin.

## Consequences
- ~100 lines of SSE client code instead of a library; one header convention everywhere.
- In client mode (LAN) the client secret is replaced by TLS + sessions; the header code path stays.

## Alternatives considered
- `EventSource` with a stream ticket in the query string: tokens in URLs/logs.
- Cookies: conflicts with memory-only tokens and adds CSRF concerns.
- Tauri IPC for data: couples the UI to the local process and breaks server mode.
