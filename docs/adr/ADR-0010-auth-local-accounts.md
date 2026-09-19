# ADR-0010: Auth: local accounts, Argon2id, opaque hashed sessions, code-defined RBAC

- **Status:** Accepted (spec v1.1, 2026-09-20) — amended
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-03, D-07, D-20, D-24), §4.12, §10

## Context
Admin-created local accounts with roles ADMINISTRATOR and PROFESSOR, an open-department visibility model with
ownership-based editing, no SSO in the MVP, and shared machines are possible.

## Decision
- Argon2id via `@node-rs/argon2` (prebuilt): m ≥ 19 MiB, t = 2, p = 1, tuned to ~250–500 ms.
- Opaque 256-bit session tokens stored as SHA-256 hashes. Idle auto-lock (15 min default, enforced server-side) and
  12 h absolute expiry. The UI keeps the token in memory only.
- Login throttling and lockout (5 failures → 5 min, exponential). Forced password change on first login.
  Admin resets. The first-run wizard creates the first admin and a one-time recovery code.
- Host mode: every request also carries the per-launch client secret. The local API binds loopback only, with a
  Host allowlist, a CORS allowlist for the Tauri origin and a strict CSP.
- RBAC defined in code (`packages/contracts/permissions.ts` + backend `policy.can/assertCan`) with
  ownership predicates, enforced in application services. The UI only hides controls.
- `AuthProvider` boundary so SSO can be added later.

## Consequences
- No self-service password reset (no email in the MVP).
- The permission-matrix test covers every action × role × ownership combination.

## Alternatives considered
- Windows identity: breaks on shared PCs and accounts.
- SSO: needs internet and IT registration; later, behind `AuthProvider`.

## Amendments (v1.1)
- Header names and SSE authentication are defined in ADR-0017.
