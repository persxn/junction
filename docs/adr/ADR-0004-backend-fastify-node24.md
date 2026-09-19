# ADR-0004: Backend: Fastify on Node.js 24 LTS; ship official node.exe

- **Status:** Accepted (spec v1.1, 2026-09-20)
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §4.0, §4.3, §4.4, §4.13

## Context
The backend holds all business logic, runs identically in host and server mode, and needs mature
HTTP, scraping and validation ecosystems (ADR-0003: one language end-to-end).

## Decision
- **Node.js 24 LTS + Fastify 5**, TypeScript strict.
- REST/JSON `/api/v1`, SSE `/api/v1/stream`, RFC 9457 problem+json errors with a stable `code`, cursor
  pagination, optimistic concurrency via `version` → 409.
- Ship the **official signed `node.exe`** (pinned LTS) with an esbuild single-file backend bundle plus a
  native-modules folder. Pin Node so native-addon ABIs stay deterministic.
- CPU-heavy work runs off the request path (job runner / `worker_threads`).

## Consequences
- ~60–120 MB idle, 200–350 MB during scrape bursts (*estimate*).
- Native addons (better-sqlite3, argon2) need prebuilt binaries for the pinned Node version.
- The REST API survives a move to a LAN server and serves future web/mobile clients.

## Alternatives considered
- **Python + FastAPI:** strong scraping and date libraries, but a second language, weaker shared typing, and
  PyInstaller-style packaging often trips antivirus.
- **ASP.NET Core:** robust and light, but splits the language from the UI.
- API style: tRPC (TS-only coupling), GraphQL (overkill), gRPC (poor browser support).
